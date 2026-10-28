import { describe, expect, it } from 'vitest';
import { JudgeEngine } from '../src/core/judge';
import { runReplay, sameStats, type ReplayInput } from '../src/core/replay';
import { parseSimai } from '../src/core/simai';

function chartOf(body: string) {
  return parseSimai(`(120){4}${body}`, { bpm: 120 }).chart;
}

describe('replay determinism', () => {
  it('reproduces the same judgments from recorded inputs', () => {
    const chart = chartOf('1,2h[4:1],3-5[4:1],4/6');
    const engine = new JudgeEngine(chart, { windows: { critical: 20, perfect: 40, great: 80, good: 150 } });

    // Simulate a player: tap 1, hold 2, complete slide 3-5, tap 4/6.
    const inputs: ReplayInput[] = [
      { t: 5, sector: 1, down: true },
      { t: 20, sector: 1, down: false },
      { t: 500, sector: 2, down: true },
      { t: 1000, sector: 2, down: false },
      { t: 1000, sector: 3, down: true },
      { t: 1100, sector: 3, down: false },
      { t: 1400, sector: 5, down: true },
      { t: 1450, sector: 5, down: false },
      { t: 1500, sector: 4, down: true },
      { t: 1510, sector: 4, down: false },
      { t: 1510, sector: 6, down: true },
      { t: 1540, sector: 6, down: false },
    ];

    for (const input of inputs) {
      engine.advanceTo(input.t);
      if (input.down) engine.press(input.sector, input.t);
      else engine.release(input.sector, input.t);
    }
    engine.finish(5000);
    const live = engine.stats;

    const first = runReplay(chart, inputs, { windows: { critical: 20, perfect: 40, great: 80, good: 150 } });
    const second = runReplay(chart, [...inputs].reverse(), {
      windows: { critical: 20, perfect: 40, great: 80, good: 150 },
    });

    expect(sameStats(live, first)).toBe(true);
    expect(sameStats(first, second)).toBe(true);
    expect(first.resolved).toBe(chart.notes.length);
  });

  it('produces the same result regardless of input arrival order', () => {
    const chart = chartOf('1,2,3,4');
    const inputs: ReplayInput[] = [
      { t: 0, sector: 1, down: true },
      { t: 10, sector: 1, down: false },
      { t: 500, sector: 2, down: true },
      { t: 510, sector: 2, down: false },
      { t: 1000, sector: 3, down: true },
      { t: 1010, sector: 3, down: false },
      { t: 1500, sector: 4, down: true },
      { t: 1510, sector: 4, down: false },
    ];
    const a = runReplay(chart, inputs);
    const b = runReplay(chart, [inputs[7]!, inputs[0]!, inputs[4]!, inputs[2]!, inputs[6]!, inputs[1]!, inputs[3]!, inputs[5]!]);
    expect(sameStats(a, b)).toBe(true);
    expect(a.counts.critical).toBe(4);
  });
});
