import { describe, expect, it } from 'vitest';
import { JudgeEngine } from '../src/core/judge';
import { parseSimai } from '../src/core/simai';
import type { Chart } from '../src/core/types';

function chartOf(body: string): Chart {
  return parseSimai(`(120){4}${body}`, { bpm: 120 }).chart;
}

const windows = { critical: 20, perfect: 40, great: 80, good: 150 };

function engineOf(body: string, options: ConstructorParameters<typeof JudgeEngine>[1] = {}) {
  return new JudgeEngine(chartOf(body), { windows, ...options });
}

describe('JudgeEngine taps', () => {
  it('judges by timing window', () => {
    const engine = engineOf('1,,,2');
    expect(engine.press(1, 0)?.judgment).toBe('critical');
    expect(engine.press(2, 1500 + 30)?.judgment).toBe('perfect');
    expect(engine.stats.counts).toMatchObject({ critical: 1, perfect: 1 });
    expect(engine.stats.combo).toBe(2);
  });

  it('ignores presses outside the good window and misses them later', () => {
    const engine = engineOf('1,,,');
    expect(engine.press(1, 200)).toBeNull();
    engine.advanceTo(200);
    expect(engine.stats.counts.miss).toBe(1);
  });

  it('breaks combo only on configured judgments', () => {
    const engine = engineOf('1,2,3');
    engine.press(1, 0);
    engine.press(2, 500 + 100); // good
    engine.press(3, 1000);
    engine.advanceTo(1000);
    const stats = engine.stats;
    expect(stats.counts.good).toBe(1);
    expect(stats.combo).toBe(3);
    expect(stats.maxCombo).toBe(3);
  });

  it('supports auto play with critical judgments', () => {
    const engine = engineOf('1,2,3,4', { auto: true });
    engine.finish();
    const stats = engine.stats;
    expect(stats.counts.critical).toBe(4);
    expect(stats.isAllPerfect).toBe(true);
    expect(stats.achievement).toBeCloseTo(101, 5);
  });

  it('counts fast and late taps', () => {
    const engine = engineOf('1,2');
    engine.press(1, -15);
    engine.press(2, 500 + 15);
    expect(engine.stats.fast).toBe(1);
    expect(engine.stats.late).toBe(1);
  });
});

describe('JudgeEngine holds', () => {
  it('completes a hold that is released after the tail', () => {
    const engine = engineOf('1h[4:2]'); // 2 beats -> 1000ms
    engine.press(1, 0);
    engine.advanceTo(1000);
    expect(engine.stats.counts.critical).toBe(1);
    engine.release(1, 1000);
    expect(engine.stats.counts.critical).toBe(1);
    expect(engine.stats.combo).toBe(1);
  });

  it('downgrades an early release', () => {
    const engine = engineOf('1h[4:2]');
    engine.press(1, 0);
    engine.release(1, 600);
    expect(engine.stats.counts.good).toBe(1);
  });

  it('misses a hold released too early', () => {
    const engine = engineOf('1h[4:2]');
    engine.press(1, 0);
    engine.release(1, 400);
    expect(engine.stats.counts.miss).toBe(1);
  });
});

describe('JudgeEngine slides', () => {
  it('completes a slide when waypoints are pressed in order', () => {
    const engine = engineOf('1-3[4:1]');
    engine.press(1, 0);
    expect(engine.stats.counts.critical).toBe(0);
    engine.press(3, 600);
    expect(engine.stats.counts.critical).toBe(1);
    expect(engine.stats.combo).toBe(1);
  });

  it('misses a slide whose waypoint never arrives', () => {
    const engine = engineOf('1-3[4:1]');
    engine.press(1, 0);
    engine.advanceTo(1100);
    expect(engine.stats.counts.miss).toBe(1);
  });

  it('partially credits a slide with some waypoints', () => {
    const engine = engineOf('1-3[4:1]-5[4:1]');
    engine.press(1, 0);
    engine.press(3, 500);
    engine.advanceTo(2000);
    expect(engine.stats.counts.miss).toBe(0);
    expect(engine.stats.counts.good).toBe(1);
  });

  it('auto-completes slides in auto mode', () => {
    const engine = engineOf('1-3[4:1]', { auto: true });
    engine.finish();
    expect(engine.stats.counts.critical).toBe(1);
  });
});

describe('JudgeEngine completion', () => {
  it('finishes all notes and reports stats', () => {
    const engine = engineOf('1,2h[4:1],3-5[4:1]');
    engine.finish();
    const stats = engine.stats;
    expect(stats.total).toBe(3);
    expect(stats.resolved).toBe(3);
    expect(engine.isFinished).toBe(true);
    expect(stats.achievement).toBe(0);
  });
});
