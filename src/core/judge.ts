import type { Judgment, Note } from './types';
import type { Chart } from './types';
import {
  DEFAULT_COMBO_BREAK,
  JUDGE_PRESETS,
  NOTE_WEIGHTS,
  type JudgePresetName,
  type JudgeWindows,
} from './balance';
import { isAllPerfect, isFullCombo } from './score';
import type { JudgmentCounts } from './score';
import type { SlideMode } from './settings';

export interface JudgeOptions {
  preset?: JudgePresetName;
  windows?: Partial<JudgeWindows>;
  slideMode?: SlideMode;
  holdGraceMs?: number;
  comboBreakOn?: Judgment[];
  slidePartial?: Judgment;
  auto?: boolean;
}

export interface JudgmentEvent {
  noteId: number;
  kind: Note['kind'];
  judgment: Judgment;
  deltaMs: number | null;
  atMs: number;
  combo: number;
  isBreak: boolean;
}

export type NoteStatus = 'pending' | 'holding' | 'sliding' | 'done';

export interface NoteRuntime {
  note: Note;
  status: NoteStatus;
  judgment?: Judgment;
  headJudgment?: Judgment;
  headDeltaMs: number | null;
  /** Next slide waypoint index to satisfy. */
  waypointIndex: number;
}

export interface JudgeStats {
  counts: JudgmentCounts;
  combo: number;
  maxCombo: number;
  resolved: number;
  total: number;
  achievement: number;
  fast: number;
  late: number;
  emptyPresses: number;
  isAllPerfect: boolean;
  isFullCombo: boolean;
}

/**
 * Event-driven judgment engine.
 *
 * The engine never reads the wall clock: callers push timestamps in chart time.
 * That keeps replays and unit tests deterministic.
 */
export class JudgeEngine {
  readonly runtimes: NoteRuntime[];
  private readonly windows: JudgeWindows;
  private readonly slideMode: SlideMode;
  private readonly holdGraceMs: number;
  private readonly comboBreakOn: Set<Judgment>;
  private readonly slidePartial: Judgment;
  private readonly auto: boolean;
  private readonly total: number;

  private counts: JudgmentCounts = { critical: 0, perfect: 0, great: 0, good: 0, miss: 0 };
  private combo = 0;
  private maxCombo = 0;
  private resolved = 0;
  private scoreSum = 0;
  private fast = 0;
  private late = 0;
  private emptyPresses = 0;
  private events: JudgmentEvent[] = [];
  private lastEvent: JudgmentEvent | null = null;

  constructor(chart: Chart, options: JudgeOptions = {}) {
    const preset = JUDGE_PRESETS[options.preset ?? 'keyboard'];
    this.windows = { ...preset.windows, ...options.windows };
    this.slideMode = options.slideMode ?? 'waypoint';
    this.holdGraceMs = options.holdGraceMs ?? preset.holdGraceMs;
    this.comboBreakOn = new Set(options.comboBreakOn ?? DEFAULT_COMBO_BREAK);
    this.slidePartial = options.slidePartial ?? 'good';
    this.auto = options.auto ?? false;
    this.total = chart.notes.length;
    this.runtimes = chart.notes.map((note) => ({
      note,
      status: 'pending' as NoteStatus,
      headDeltaMs: null,
      waypointIndex: 0,
    }));
  }

  /** Resolve everything whose window has elapsed. Call once per rendered frame. */
  advanceTo(timeMs: number): void {
    for (const runtime of this.runtimes) {
      if (runtime.status === 'done') continue;
      const note = runtime.note;

      if (this.auto) {
        this.advanceAuto(runtime, timeMs);
        continue;
      }

      if (runtime.status === 'pending') {
        if (timeMs > note.timeMs + this.windows.good) {
          this.finalize(runtime, 'miss', timeMs, null);
        }
      } else if (runtime.status === 'holding') {
        if (timeMs >= note.endMs) {
          this.finalize(runtime, runtime.headJudgment ?? 'perfect', note.endMs, runtime.headDeltaMs);
        }
      } else if (runtime.status === 'sliding') {
        if (timeMs >= note.endMs) {
          const segments = note.slide ?? [];
          if (runtime.waypointIndex >= segments.length) {
            this.finalize(runtime, runtime.headJudgment ?? 'perfect', note.endMs, runtime.headDeltaMs);
          } else if (runtime.waypointIndex > 0) {
            this.finalize(runtime, this.slidePartial, note.endMs, runtime.headDeltaMs);
          } else {
            this.finalize(runtime, 'miss', note.endMs, runtime.headDeltaMs);
          }
        }
      }
    }
  }

  /** Register a key press on `sector` at chart time `timeMs`. */
  press(sector: number, timeMs: number): JudgmentEvent | null {
    if (this.auto) return null;
    let event: JudgmentEvent | null = null;

    // Slide waypoints are satisfied in order; each press may advance all slides
    // currently waiting for that button.
    for (const runtime of this.runtimes) {
      if (runtime.status !== 'sliding') continue;
      const segments = runtime.note.slide;
      if (!segments) continue;
      const next = segments[runtime.waypointIndex];
      if (!next || next.to !== sector) continue;
      if (timeMs > runtime.note.endMs + 1) continue;
      runtime.waypointIndex++;
      if (runtime.waypointIndex >= segments.length) {
        event = this.finalize(runtime, runtime.headJudgment ?? 'perfect', timeMs, runtime.headDeltaMs) ?? event;
      }
    }

    let best: NoteRuntime | null = null;
    let bestAbs = Number.POSITIVE_INFINITY;
    for (const runtime of this.runtimes) {
      if (runtime.status !== 'pending') continue;
      if (runtime.note.sector !== sector) continue;
      const abs = Math.abs(timeMs - runtime.note.timeMs);
      if (abs <= this.windows.good && abs < bestAbs) {
        best = runtime;
        bestAbs = abs;
      }
    }

    if (best) {
      event = this.judgeHead(best, timeMs) ?? event;
    } else if (!event) {
      this.emptyPresses++;
    }
    return event;
  }

  /** Register a key release on `sector` at chart time `timeMs`. */
  release(sector: number, timeMs: number): void {
    if (this.auto) return;
    for (const runtime of this.runtimes) {
      if (runtime.status !== 'holding') continue;
      if (runtime.note.sector !== sector) continue;
      const note = runtime.note;
      if (timeMs >= note.endMs - this.holdGraceMs) {
        this.finalize(runtime, runtime.headJudgment ?? 'perfect', Math.min(timeMs, note.endMs), runtime.headDeltaMs);
      } else {
        const span = Math.max(1, note.endMs - note.timeMs);
        const ratio = (timeMs - note.timeMs) / span;
        this.finalize(runtime, ratio >= 0.5 ? 'good' : 'miss', timeMs, runtime.headDeltaMs);
      }
    }
  }

  /** Force-resolve every remaining note (used when a chart ends). */
  finish(timeMs = Number.MAX_SAFE_INTEGER): void {
    this.advanceTo(timeMs);
    for (const runtime of this.runtimes) {
      if (runtime.status === 'done') continue;
      if (runtime.status === 'pending') {
        this.finalize(runtime, 'miss', runtime.note.timeMs, null);
      } else if (runtime.status === 'holding') {
        this.finalize(runtime, runtime.headJudgment ?? 'perfect', runtime.note.endMs, runtime.headDeltaMs);
      } else if (runtime.status === 'sliding') {
        const segments = runtime.note.slide ?? [];
        const judgment = runtime.waypointIndex >= segments.length
          ? runtime.headJudgment ?? 'perfect'
          : runtime.waypointIndex > 0
            ? this.slidePartial
            : 'miss';
        this.finalize(runtime, judgment, runtime.note.endMs, runtime.headDeltaMs);
      }
    }
  }

  drainEvents(): JudgmentEvent[] {
    if (this.events.length === 0) return [];
    const drained = this.events;
    this.events = [];
    return drained;
  }

  get lastJudgment(): JudgmentEvent | null {
    return this.lastEvent;
  }

  get achievement(): number {
    if (this.total === 0) return 0;
    return (this.scoreSum / this.total) * 100;
  }

  get stats(): JudgeStats {
    return {
      counts: { ...this.counts },
      combo: this.combo,
      maxCombo: this.maxCombo,
      resolved: this.resolved,
      total: this.total,
      achievement: this.achievement,
      fast: this.fast,
      late: this.late,
      emptyPresses: this.emptyPresses,
      isAllPerfect: isAllPerfect(this.counts),
      isFullCombo: isFullCombo(this.counts),
    };
  }

  get isFinished(): boolean {
    return this.resolved >= this.total;
  }

  judgmentFor(deltaMs: number): Judgment | null {
    const abs = Math.abs(deltaMs);
    if (abs <= this.windows.critical) return 'critical';
    if (abs <= this.windows.perfect) return 'perfect';
    if (abs <= this.windows.great) return 'great';
    if (abs <= this.windows.good) return 'good';
    return null;
  }

  private judgeHead(runtime: NoteRuntime, timeMs: number): JudgmentEvent | null {
    const note = runtime.note;
    const delta = timeMs - note.timeMs;
    const judgment = this.judgmentFor(delta);
    if (!judgment) return null;

    runtime.headJudgment = judgment;
    runtime.headDeltaMs = delta;

    if (note.kind === 'hold' || note.kind === 'touchHold') {
      runtime.status = 'holding';
      return null;
    }
    if (note.kind === 'slide') {
      runtime.status = 'sliding';
      runtime.waypointIndex = 0;
      const segments = note.slide ?? [];
      if (this.slideMode === 'auto' || segments.length === 0) {
        // Auto slides resolve at their end time so the visuals still play.
        return null;
      }
      return null;
    }
    return this.finalize(runtime, judgment, timeMs, delta);
  }

  private advanceAuto(runtime: NoteRuntime, timeMs: number): void {
    const note = runtime.note;
    if (runtime.status === 'pending') {
      if (timeMs + 1e-6 < note.timeMs) return;
      if (note.kind === 'hold' || note.kind === 'touchHold') {
        runtime.status = 'holding';
        runtime.headJudgment = 'critical';
        runtime.headDeltaMs = 0;
      } else if (note.kind === 'slide') {
        runtime.status = 'sliding';
        runtime.headJudgment = 'critical';
        runtime.headDeltaMs = 0;
      } else {
        this.finalize(runtime, 'critical', note.timeMs, 0);
        return;
      }
    }
    if ((runtime.status === 'holding' || runtime.status === 'sliding') && timeMs >= note.endMs) {
      this.finalize(runtime, 'critical', note.endMs, 0);
    }
  }

  private finalize(
    runtime: NoteRuntime,
    judgment: Judgment,
    timeMs: number,
    deltaMs: number | null,
  ): JudgmentEvent | null {
    if (runtime.status === 'done') return null;
    runtime.status = 'done';
    runtime.judgment = judgment;

    this.counts[judgment]++;
    this.resolved++;
    this.scoreSum += NOTE_WEIGHTS[judgment];

    if (this.comboBreakOn.has(judgment)) {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }

    const note = runtime.note;
    if (deltaMs !== null && (note.kind === 'tap' || note.kind === 'touch')) {
      if (deltaMs < -0.0001) this.fast++;
      else if (deltaMs > 0.0001) this.late++;
    }

    const event: JudgmentEvent = {
      noteId: note.id,
      kind: note.kind,
      judgment,
      deltaMs,
      atMs: timeMs,
      combo: this.combo,
      isBreak: note.isBreak,
    };
    this.events.push(event);
    this.lastEvent = event;
    return event;
  }
}
