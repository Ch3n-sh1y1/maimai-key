import { describe, expect, it } from 'vitest';
import { generateCharts, type AudioAnalysis } from '../src/app/auto-chart';
import { parseSimai } from '../src/core/simai';

const analysis: AudioAnalysis = {
  bpm: 150,
  confidence: 0.9,
  durationMs: 12000,
  beatPhaseMs: 0,
  onsets: Array.from({ length: 24 }, (_, index) => ({
    t: 800 + index * 450,
    strength: index % 4 === 0 ? 0.95 : 0.55 + (index % 5) * 0.06,
  })),
};

const options = {
  offsetMs: 0,
  density: 1,
  includeHolds: true,
  includeSlides: true,
  includeTouches: true,
  seed: 42,
};

describe('audio chart generation', () => {
  it('produces four parseable difficulties with notes', () => {
    const charts = generateCharts(analysis, options);
    expect(charts.bpm).toBe(150);
    expect(charts.difficulties).toHaveLength(4);
    for (const difficulty of charts.difficulties) {
      const parsed = parseSimai(difficulty.body, { bpm: charts.bpm });
      expect(parsed.warnings).toEqual([]);
      expect(parsed.chart.notes.length).toBeGreaterThan(5);
      expect(difficulty.noteCount).toBeGreaterThan(5);
      expect(parsed.chart.durationMs).toBeGreaterThan(10000);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateCharts(analysis, options);
    const b = generateCharts(analysis, options);
    expect(a.difficulties.map((d) => d.body)).toEqual(b.difficulties.map((d) => d.body));
  });

  it('keeps generated note times close to detected onsets', () => {
    const charts = generateCharts(analysis, options);
    const parsed = parseSimai(charts.difficulties[0]!.body, { bpm: charts.bpm });
    const first = parsed.chart.notes[0]!;
    expect(first.timeMs).toBeGreaterThanOrEqual(700);
    expect(first.timeMs).toBeLessThanOrEqual(1400);
  });
});
