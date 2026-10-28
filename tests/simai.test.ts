import { describe, expect, it } from 'vitest';
import { parseMaidata, parseSimai, splitSlots } from '../src/core/simai';

function notesOf(body: string, bpm = 120) {
  return parseSimai(body, { bpm }).chart.notes;
}

describe('splitSlots', () => {
  it('ignores commas inside brackets', () => {
    expect(splitSlots('1,[4:1],2')).toEqual(['1', '[4:1]', '2']);
    expect(splitSlots('1-3[4:1],2')).toEqual(['1-3[4:1]', '2']);
  });
});

describe('parseSimai timing', () => {
  it('places quarter notes on 500ms steps at 120 BPM', () => {
    const notes = notesOf('(120){4}1,2,3,4');
    expect(notes.map((n) => n.timeMs)).toEqual([0, 500, 1000, 1500]);
    expect(notes.map((n) => n.sector)).toEqual([1, 2, 3, 4]);
  });

  it('supports eighth-note grids', () => {
    const notes = notesOf('(120){8}1,,2,,3');
    expect(notes.map((n) => n.timeMs)).toEqual([0, 500, 1000]);
  });

  it('applies tempo changes to following slots', () => {
    const notes = notesOf('(120){4}1,2,(240)3,4');
    expect(notes.map((n) => n.timeMs)).toEqual([0, 500, 1000, 1250]);
  });

  it('handles rests and the E terminator', () => {
    const notes = notesOf('(120){4}1,,,,E,,,,2');
    expect(notes).toHaveLength(1);
  });
});

describe('parseSimai notes', () => {
  it('parses holds with [q:m] durations', () => {
    const [hold] = notesOf('1h[4:1]');
    expect(hold).toMatchObject({ kind: 'hold', timeMs: 0, endMs: 500 });
  });

  it('parses slides with button waypoints and a default beat of wait', () => {
    const [slide] = notesOf('1-3[4:1]');
    expect(slide).toMatchObject({ kind: 'slide', sector: 1, timeMs: 0, endMs: 1000 });
    expect(slide?.slide).toEqual([{ shape: '-', to: 3, durationMs: 500 }]);
    expect(slide?.slideWaitMs).toBe(500);
  });

  it('parses chained and multiple slide sets', () => {
    const chained = notesOf('1-3[4:1]-5[4:1]');
    expect(chained).toHaveLength(1);
    expect(chained[0]?.slide?.map((s) => s.to)).toEqual([3, 5]);

    const wifi = notesOf('1-5[4:1]*-8[4:1]');
    expect(wifi).toHaveLength(2);
    expect(wifi.map((n) => n.slide?.[0]?.to)).toEqual([5, 8]);
    expect(wifi[0]?.id).not.toBe(wifi[1]?.id);
  });

  it('parses break, ex and touch notations', () => {
    const notes = notesOf('1b,2x,A3');
    expect(notes[0]).toMatchObject({ isBreak: true, kind: 'tap' });
    expect(notes[1]).toMatchObject({ isEx: true, kind: 'tap' });
    expect(notes[2]).toMatchObject({ kind: 'touch', sensor: 'A', sector: 3 });
  });

  it('parses simultaneous notes separated by slash and bare digit runs', () => {
    const slash = notesOf('1/2');
    expect(slash.map((n) => n.sector)).toEqual([1, 2]);
    const run = notesOf('12');
    expect(run.map((n) => n.sector)).toEqual([1, 2]);
  });

  it('parses second-based durations', () => {
    const notes = notesOf('1h[#0.75]');
    expect(notes[0]?.endMs).toBeCloseTo(750, 5);
  });

  it('reports unsupported tokens without throwing', () => {
    const result = parseSimai('(120){4}1,?,3');
    expect(result.chart.notes).toHaveLength(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseMaidata', () => {
  it('extracts metadata, levels and the first-note offset', () => {
    const file = parseMaidata(
      [
        '&title=Test Song',
        '&artist=Someone',
        '&first=0.25',
        '&wholebpm=150',
        '&lv_3=9',
        '&inote_3=(150){4}1,2,3,4',
        'E',
        '&lv_4=12',
        '&inote_4=(150){4}8,7,6,5',
        'E',
      ].join('\n'),
    );
    expect(file.title).toBe('Test Song');
    expect(file.firstSeconds).toBe(0.25);
    expect(file.wholeBpm).toBe(150);
    expect(file.levels.map((l) => l.index)).toEqual([3, 4]);
    expect(file.levels[0]?.levelText).toBe('9');
    expect(file.levels[0]?.body).toContain('1,2,3,4');
  });
});
