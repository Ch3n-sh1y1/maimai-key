import type { Chart } from './types';
import { JudgeEngine, type JudgeOptions, type JudgeStats } from './judge';

export interface ReplayInput {
  /** Chart time in ms. */
  t: number;
  sector: number;
  down: boolean;
}

export interface Replay {
  version: 1;
  packId: string;
  difficulty: number;
  difficultyName: string;
  title: string;
  createdAt: number;
  inputs: ReplayInput[];
}

/**
 * Feed a recorded input stream through a fresh judge engine.
 *
 * Because the engine only consumes explicit timestamps, replaying the same
 * inputs against the same chart must reproduce identical statistics. This is
 * covered by tests and is what the in-game replay playback uses.
 */
export function runReplay(chart: Chart, inputs: ReplayInput[], options: JudgeOptions = {}): JudgeStats {
  const engine = new JudgeEngine(chart, options);
  const sorted = [...inputs].sort((a, b) => a.t - b.t);
  for (const input of sorted) {
    engine.advanceTo(input.t);
    if (input.down) engine.press(input.sector, input.t);
    else engine.release(input.sector, input.t);
  }
  engine.finish(Math.max(chart.durationMs + 1000, sorted[sorted.length - 1]?.t ?? 0));
  return engine.stats;
}

export function sameStats(a: JudgeStats, b: JudgeStats): boolean {
  return (
    a.counts.critical === b.counts.critical &&
    a.counts.perfect === b.counts.perfect &&
    a.counts.great === b.counts.great &&
    a.counts.good === b.counts.good &&
    a.counts.miss === b.counts.miss &&
    a.combo === b.combo &&
    a.maxCombo === b.maxCombo &&
    a.resolved === b.resolved &&
    Math.abs(a.achievement - b.achievement) < 1e-9
  );
}
