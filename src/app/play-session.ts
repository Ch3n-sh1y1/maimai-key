import type { Application } from 'pixi.js';
import { JudgeEngine, type JudgeStats } from '../core/judge';
import { gradeOf } from '../core/score';
import type { Chart } from '../core/types';
import type { ReplayInput } from '../core/replay';
import type { GameSettings } from '../core/settings';
import { GameAudio } from './audio';
import type { LoadedPack } from './content';
import { isModalOpen } from './modal';
import { KeyboardInput } from './input';
import { PointerInput } from './pointer-input';
import { PlayRenderer } from './play-renderer';
import { showCanvas } from './pixi';

declare global {
  interface Window {
    __maimaiDebug?: {
      stats: () => JudgeStats | null;
      runtimes: () => number;
      clock: () => number;
    };
  }
}

export interface PlaySetup {
  app: Application;
  pack: LoadedPack;
  difficultyIndex: number;
  settings: GameSettings;
  auto: boolean;
  audioBytes: ArrayBuffer;
  backgroundUrl?: string | null;
  /** When present, the session replays these inputs instead of reading the keyboard. */
  replayInputs?: ReplayInput[];
}

export interface PlayOutcome {
  pack: LoadedPack;
  difficultyIndex: number;
  stats: JudgeStats;
  grade: string;
  auto: boolean;
  replayMode: boolean;
  inputs: ReplayInput[];
}

export interface PlayCallbacks {
  onFinish: (outcome: PlayOutcome) => void;
  onPauseChange: (paused: boolean) => void;
}

/** A single play attempt: owns the judge, renderer, audio clock and input. */
export class PlaySession {
  private readonly app: Application;
  private readonly setup: PlaySetup;
  private readonly callbacks: PlayCallbacks;
  private readonly keyboard = new KeyboardInput();
  private readonly pointer = new PointerInput();
  private readonly audio = new GameAudio();

  private judge!: JudgeEngine;
  private renderer!: PlayRenderer;
  private raf = 0;
  private paused = false;
  private finished = false;
  private destroyed = false;
  private lastNoteEnd = 0;
  private frameTime = 0;
  private lastFrameAt = 0;
  private lastRenderAt = 0;
  private replayQueue: ReplayInput[] = [];
  private replayIndex = 0;
  private replayMode = false;
  private recordedInputs: ReplayInput[] = [];

  constructor(setup: PlaySetup, callbacks: PlayCallbacks) {
    this.setup = setup;
    this.app = setup.app;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    const { settings, pack, difficultyIndex, audioBytes, auto, replayInputs } = this.setup;
    showCanvas(this.app, true);

    this.audio.setVolume(settings.volume);
    this.audio.setSfxVolume(settings.sfxVolume);
    this.audio.setHitsEnabled(!auto);
    const buffer = await this.audio.decode(audioBytes);
    if (this.finished) return;

    this.replayQueue = replayInputs ? [...replayInputs].sort((a, b) => a.t - b.t) : [];
    this.replayIndex = 0;
    this.replayMode = this.replayQueue.length > 0;

    const baseChart = pack.charts[difficultyIndex]!;
    const shift = (pack.manifest.audioOffsetMs ?? 0) + settings.offsets.audioMs;
    const chart = shiftChart(baseChart, shift);
    const seekMs = readSeek();
    const playableChart = seekMs > 0
      ? { ...chart, notes: chart.notes.filter((note) => note.timeMs + 250 >= seekMs) }
      : chart;
    this.lastNoteEnd = playableChart.notes.reduce((max, note) => Math.max(max, note.endMs), 0);

    this.judge = new JudgeEngine(playableChart, {
      preset: settings.judgePreset,
      slideMode: settings.slideMode,
      auto,
    });
    window.__maimaiDebug = {
      stats: () => this.judge?.stats ?? null,
      runtimes: () => this.judge?.runtimes.length ?? 0,
      clock: () => this.audio.chartMs(),
    };

    this.renderer = new PlayRenderer(
      this.app,
      playableChart,
      settings,
      {
        title: pack.manifest.title,
        difficulty: pack.manifest.difficulties[difficultyIndex]?.name ?? 'Unknown',
        level: pack.manifest.difficulties[difficultyIndex]?.level ?? 1,
      },
      this.setup.backgroundUrl ?? null,
    );

    if (this.replayMode) {
      this.keyboard.setKeys({});
      this.keyboard.attach({
        onEscape: () => this.togglePause(),
      });
    } else if (!auto) {
      if (settings.inputMode === 'touch') {
        this.pointer.attach(this.app.canvas as HTMLCanvasElement, {
          resolveSector: (x, y) => this.renderer.sectorAtScreen(x, y),
          onDown: (sector, performanceTime) => this.handleDown(sector, performanceTime),
          onUp: (sector, performanceTime) => this.handleUp(sector, performanceTime),
        });
      } else {
        this.keyboard.setKeys(settings.keys);
        this.keyboard.attach({
          onDown: (sector, performanceTime) => this.handleDown(sector, performanceTime),
          onUp: (sector, performanceTime) => this.handleUp(sector, performanceTime),
          onEscape: () => this.togglePause(),
        });
      }
    }

    window.addEventListener('keydown', this.handleEscape, true);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);

    await this.audio.start(buffer, seekMs, 480);
    this.audio.setVolume(settings.volume);
    this.startLoop();
  }

  private handleEscape = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape' || event.repeat) return;
    if (isModalOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.togglePause();
  };

  setBackground(url: string | null): void {
    void this.renderer?.setBackground(url);
  }

  togglePause(): void {
    if (this.finished) return;
    if (this.paused) void this.resume();
    else this.pause();
  }

  pause(): void {
    if (this.paused || this.finished) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this.audio.pause();
    this.callbacks.onPauseChange(true);
  }

  async resume(): Promise<void> {
    if (!this.paused || this.finished) return;
    this.paused = false;
    await this.audio.resume();
    this.callbacks.onPauseChange(false);
    this.startLoop();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finished = true;
    window.removeEventListener('keydown', this.handleEscape, true);
    cancelAnimationFrame(this.raf);
    this.keyboard.detach();
    this.pointer.detach();
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.audio.stop();
    this.audio.destroy();
    this.renderer?.destroy();
    showCanvas(this.app, false);
    window.__maimaiDebug = undefined;
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    const frame = () => {
      if (this.finished || this.paused) return;
      this.raf = requestAnimationFrame(frame);
      this.step();
    };
    this.raf = requestAnimationFrame(frame);
  }

  private step(): void {
    const now = performance.now();
    this.frameTime = now - (this.lastFrameAt ?? now);
    this.lastFrameAt = now;

    const chartMs = this.audio.chartMs();
    if (this.replayMode) this.pumpReplay(chartMs);
    this.judge.advanceTo(chartMs);
    for (const event of this.judge.drainEvents()) {
      this.renderer.onJudgment(event);
      if (!this.setup.auto) this.audio.playHit(event.judgment);
    }

    const renderInterval = 1000 / Math.max(60, this.setup.settings.fpsCap);
    if (now - this.lastRenderAt >= renderInterval - 0.5) {
      this.renderer.update(chartMs - this.setup.settings.offsets.visualMs, this.judge);
      this.app.renderer.render(this.app.stage);
      this.lastRenderAt = now;
    }

    if (chartMs > this.lastNoteEnd + 1800 || chartMs > this.setup.pack.charts[this.setup.difficultyIndex]!.durationMs + 2500) {
      this.finish();
    }
  }

  private pumpReplay(chartMs: number): void {
    while (this.replayIndex < this.replayQueue.length) {
      const input = this.replayQueue[this.replayIndex]!;
      if (input.t > chartMs) break;
      this.replayIndex++;
      if (input.down) {
        this.judge.press(input.sector, input.t);
        this.renderer.flash(input.sector);
      } else {
        this.judge.release(input.sector, input.t);
      }
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.judge.finish();
    const stats = this.judge.stats;
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.keyboard.detach();
    this.pointer.detach();
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.audio.stop();
    this.callbacks.onFinish({
      pack: this.setup.pack,
      difficultyIndex: this.setup.difficultyIndex,
      stats,
      grade: gradeOf(stats.achievement),
      auto: this.setup.auto,
      replayMode: this.replayMode,
      inputs: this.replayMode ? this.replayQueue : this.recordedInputs,
    });
  }

  private handleDown(sector: number, performanceTime: number): void {
    if (this.paused || this.finished || this.replayMode) return;
    const offsets = this.setup.settings.offsets;
    const chartTime = this.audio.chartMsAt(performanceTime) - offsets.inputMs;
    this.recordedInputs.push({ t: chartTime, sector, down: true });
    this.judge.press(sector, chartTime);
    this.renderer.flash(sector);
  }

  private handleUp(sector: number, performanceTime: number): void {
    if (this.paused || this.finished || this.replayMode) return;
    const offsets = this.setup.settings.offsets;
    const chartTime = this.audio.chartMsAt(performanceTime) - offsets.inputMs;
    this.recordedInputs.push({ t: chartTime, sector, down: false });
    this.judge.release(sector, chartTime);
  }

  private handleBlur = (): void => {
    if (!this.finished && !this.paused) this.pause();
  };

  private handleVisibility = (): void => {
    if (document.hidden && !this.finished && !this.paused) this.pause();
  };

  get frameDelta(): number {
    return this.frameTime;
  }
}

function shiftChart(chart: Chart, offsetMs: number): Chart {
  if (!offsetMs) return chart;
  return {
    ...chart,
    notes: chart.notes.map((note) => ({
      ...note,
      timeMs: note.timeMs + offsetMs,
      endMs: note.endMs + offsetMs,
    })),
    durationMs: chart.durationMs + offsetMs,
  };
}

/** Debug/practice helper: `?seek=<ms>` starts playback inside the chart. */
function readSeek(): number {
  try {
    const value = Number(new URLSearchParams(window.location.search).get('seek') ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
