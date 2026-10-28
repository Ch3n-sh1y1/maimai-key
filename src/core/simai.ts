import type { Chart, ChartMeta, Note, SlideShape, SlideSpec } from './types';

/**
 * Simai / maidata.txt parser.
 *
 * Format facts (verified against MaiLib's formal spec and parser):
 *  - a chart body is a comma separated list of "slots";
 *  - `(bpm)` changes tempo, `{n}` sets how many slots fit in one 4/4 measure;
 *  - one measure is 4 beats, one slot lasts `4 * 60000 / (bpm * n)` ms;
 *  - `[q:m]` durations mean `m` notes of `1/q` value, i.e. `(4 / q) * m` beats;
 *  - slides have a default 1-beat wait before the trace starts moving.
 *
 * The parser is intentionally forgiving: unsupported or malformed tokens are
 * reported as warnings instead of aborting the whole chart.
 */

const DEFAULT_BPM = 120;
const SLIDE_CHARS = new Set(['-', '<', '>', '^', 'v', 'p', 'q', 's', 'z', 'w', 'V']);
const SLIDE_TYPES = ['pp', 'qq', '-', '<', '>', '^', 'v', 'p', 'q', 's', 'z', 'w', 'V'] as const;

export interface SimaiParseOptions {
  bpm?: number;
  difficultyName?: string;
  level?: number;
  audioOffsetMs?: number;
  title?: string;
  artist?: string;
  charter?: string;
}

export interface SimaiParseResult {
  chart: Chart;
  warnings: string[];
}

interface DurationSpec {
  waitMs: number;
  lastMs: number;
  hasExplicitWait: boolean;
}

export function parseSimai(body: string, options: SimaiParseOptions = {}): SimaiParseResult {
  const warnings: string[] = [];
  const baseBpm = options.bpm ?? DEFAULT_BPM;
  const slots = splitSlots(body);
  const notes: Note[] = [];
  let nextId = 0;
  let timeMs = 0;
  let bpm = baseBpm;
  let grid = 4;
  let ended = false;

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    if (ended) break;
    let slot = slots[slotIndex]!.trim();

    // Leading tempo / grid definitions can appear in any order.
    for (;;) {
      const bpmMatch = /^\(([0-9]+(?:\.[0-9]+)?)\)/.exec(slot);
      if (bpmMatch) {
        const parsed = Number(bpmMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) bpm = parsed;
        slot = slot.slice(bpmMatch[0].length).trimStart();
        continue;
      }
      const gridMatch = /^\{(\d+)\}/.exec(slot);
      if (gridMatch) {
        const parsed = Number(gridMatch[1]);
        if (Number.isInteger(parsed) && parsed > 0) grid = parsed;
        slot = slot.slice(gridMatch[0].length).trimStart();
        continue;
      }
      break;
    }

    if (slot.startsWith('E')) {
      ended = true;
      // `E` may still be followed by garbage; ignore it.
    } else if (slot.length > 0) {
      const components = splitTopLevel(slot, '/');
      for (const component of components) {
        const trimmed = component.trim();
        if (trimmed.length === 0) continue;
        try {
          const parsedNotes = parseNoteComponent(trimmed, timeMs, bpm, nextId, warnings);
          for (const note of parsedNotes) {
            notes.push(note);
            nextId = Math.max(nextId, note.id + 1);
          }
        } catch (error) {
          warnings.push(`slot ${slotIndex + 1}: ${(error as Error).message} in "${trimmed}"`);
        }
      }
    }

    if (ended) break;
    const slotMs = (60000 / bpm) * 4 / grid;
    timeMs += slotMs;
  }

  notes.sort((a, b) => a.timeMs - b.timeMs || a.id - b.id);

  const lastEnd = notes.reduce((max, note) => Math.max(max, note.endMs), 0);
  const meta: ChartMeta = {
    title: options.title ?? 'Untitled',
    artist: options.artist ?? 'Unknown',
    charter: options.charter ?? 'Unknown',
    bpm: baseBpm,
    audioOffsetMs: options.audioOffsetMs ?? 0,
    difficultyName: options.difficultyName ?? 'Master',
    level: options.level ?? 1,
  };

  return {
    chart: {
      schemaVersion: 1,
      meta,
      notes,
      durationMs: Math.max(lastEnd, timeMs) + 2000,
      warnings,
    },
    warnings,
  };
}

/** Split the chart body on commas that are not inside brackets. */
export function splitSlots(body: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of body.replace(/\r/g, '')) {
    if (char === '[' || char === '(' || char === '{') depth++;
    else if (char === ']' || char === ')' || char === '}') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else if (char !== '\n') {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function splitTopLevel(value: string, separator: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '[' || char === '(' || char === '{') depth++;
    else if (char === ']' || char === ')' || char === '}') depth = Math.max(0, depth - 1);

    if (char === separator && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseNoteComponent(
  token: string,
  timeMs: number,
  bpm: number,
  nextId: number,
  warnings: string[],
): Note[] {
  let rest = token;
  let sensor: string | undefined;

  const sensorMatch = /^([A-F])/.exec(rest);
  if (sensorMatch) {
    sensor = sensorMatch[1];
    rest = rest.slice(1);
  }

  const keyMatch = /^([1-8])/.exec(rest);
  if (!keyMatch) {
    throw new Error(`expected button number 1-8, got "${token}"`);
  }
  const sector = Number(keyMatch[1]);
  rest = rest.slice(1);

  // Slide head modifiers and start postfixes.
  let isBreak = false;
  let isEx = false;
  while (rest.length > 0 && 'bx$!@'.includes(rest[0]!)) {
    if (rest[0] === 'b') isBreak = true;
    else if (rest[0] === 'x') isEx = true;
    rest = rest.slice(1);
  }

  if (rest.length > 0 && startsSlide(rest)) {
    return parseSlide(rest, sector, timeMs, bpm, nextId, isBreak, isEx, sensor, warnings);
  }

  // Hold / touch-hold: optional trailing modifiers, then `h`.
  const holdMatch = /^([bx$!@]*)h(\[[^\]]*\])?/.exec(rest);
  if (holdMatch) {
    for (const char of holdMatch[1] ?? '') {
      if (char === 'b') isBreak = true;
      else if (char === 'x') isEx = true;
    }
    const duration = parseDurationSpec(holdMatch[2], bpm, false);
    if (!duration) {
      warnings.push(`hold without duration on button ${sector}; defaulting to 1 beat`);
    }
    const lastMs = duration?.lastMs ?? beatMs(bpm);
    const isTouch = sensor !== undefined;
    return [
      {
        id: nextId,
        kind: isTouch ? 'touchHold' : 'hold',
        timeMs,
        sector,
        endMs: timeMs + lastMs,
        isBreak,
        isEx,
        ...(sensor ? { sensor } : {}),
      },
    ];
  }

  // A bare run of digits means several buttons pressed on the same slot,
  // e.g. `12` == `1/2`.
  if (rest.length > 0 && /^[1-8]+$/.test(rest)) {
    const kind: Note['kind'] = sensor ? 'touch' : 'tap';
    return [sector, ...Array.from(rest).map(Number)].map((button, index) => ({
      id: nextId + index,
      kind,
      timeMs,
      sector: button,
      endMs: timeMs,
      isBreak,
      isEx,
      ...(sensor ? { sensor } : {}),
    }));
  }

  // Remaining modifiers on a plain tap.
  let firework = false;
  for (const char of rest) {
    if (char === 'b') isBreak = true;
    else if (char === 'x') isEx = true;
    else if (char === 'f') firework = true;
    else {
      warnings.push(`ignored trailing token "${rest}" on button ${sector}`);
      break;
    }
  }
  void firework;

  return [
    {
      id: nextId,
      kind: sensor ? 'touch' : 'tap',
      timeMs,
      sector,
      endMs: timeMs,
      isBreak,
      isEx,
      ...(sensor ? { sensor } : {}),
    },
  ];
}

function startsSlide(value: string): boolean {
  for (const type of SLIDE_TYPES) {
    if (value.startsWith(type)) return true;
  }
  // A bare `V` digit pair is handled by SLIDE_TYPES through startsWith('V').
  return value.length > 0 && SLIDE_CHARS.has(value[0]!);
}

function parseSlide(
  rest: string,
  startSector: number,
  timeMs: number,
  bpm: number,
  nextId: number,
  isBreak: boolean,
  isEx: boolean,
  sensor: string | undefined,
  warnings: string[],
): Note[] {
  const sets = splitTopLevel(rest, '*');
  const notes: Note[] = [];
  for (let setIndex = 0; setIndex < sets.length; setIndex++) {
    const setText = sets[setIndex]!.trim();
    if (setText.length === 0) continue;
    const parsed = parseSlideChain(setText, bpm, warnings);
    if (parsed.specs.length === 0) continue;
    const fallback = parsed.specs[parsed.specs.length - 1]!.durationMs || beatMs(bpm);
    const specs: SlideSpec[] = parsed.specs.map((spec) => ({
      ...spec,
      durationMs: spec.durationMs > 0 ? spec.durationMs : fallback,
    }));
    const lastMs = specs.reduce((sum, spec) => sum + spec.durationMs, 0);
    const slideWait = parsed.waitMs ?? beatMs(bpm);
    const endMs = timeMs + slideWait + lastMs;
    notes.push({
      id: nextId + setIndex,
      kind: 'slide',
      timeMs,
      sector: startSector,
      endMs,
      isBreak,
      isEx,
      ...(sensor ? { sensor } : {}),
      slide: specs,
      slideWaitMs: slideWait,
    });
  }
  return notes;
}

/** Parse a slide chain like `-3[4:1]-5[2:1]`, `V53[4:1]`, `w5[4:1]`. */
function parseSlideChain(
  text: string,
  bpm: number,
  warnings: string[],
): { specs: SlideSpec[]; waitMs?: number } {
  const specs: SlideSpec[] = [];
  let rest = text;
  let waitMs: number | undefined;

  while (rest.length > 0) {
    const type = readSlideShape(rest);
    if (!type) {
      warnings.push(`unrecognised slide stroke "${rest}"`);
      break;
    }
    rest = rest.slice(type.length);

    let inflection: number | undefined;
    if (type === 'V') {
      const match = /^([1-8])/.exec(rest);
      if (!match) {
        warnings.push(`V slide without inflection button in "${text}"`);
        break;
      }
      inflection = Number(match[1]);
      rest = rest.slice(1);
    }

    const toMatch = /^([1-8])/.exec(rest);
    if (!toMatch) {
      warnings.push(`slide without destination button in "${text}"`);
      break;
    }
    const to = Number(toMatch[1]);
    rest = rest.slice(1);

    const durationMatch = /^\[([^\]]*)\]/.exec(rest);
    let durationMs = 0;
    if (durationMatch) {
      const parsed = decodeDuration(durationMatch[1]!, bpm, true);
      if (parsed) {
        durationMs = parsed.lastMs;
        if (waitMs === undefined && parsed.hasExplicitWait) waitMs = parsed.waitMs;
      }
      rest = rest.slice(durationMatch[0].length);
    }

    specs.push({
      shape: type as SlideShape,
      to,
      durationMs,
      ...(inflection !== undefined ? { inflection } : {}),
    });
    rest = rest.trimStart();
  }

  return waitMs === undefined ? { specs } : { specs, waitMs };
}

function readSlideShape(text: string): SlideShape | null {
  if (text.startsWith('pp')) return 'pp';
  if (text.startsWith('qq')) return 'qq';
  const char = text[0];
  if (!char || !SLIDE_CHARS.has(char)) return null;
  return char as SlideShape;
}

function beatMs(bpm: number): number {
  return 60000 / bpm;
}

function parseDurationSpec(
  bracket: string | undefined,
  bpm: number,
  isSlide: boolean,
): DurationSpec | null {
  if (!bracket) return null;
  const inner = bracket.slice(1, -1);
  return decodeDuration(inner, bpm, isSlide);
}

function decodeDuration(inner: string, bpm: number, isSlide: boolean): DurationSpec | null {
  if (inner.length === 0) return null;
  const trimmed = inner.trim();

  // [wait##duration] (slides only)
  if (trimmed.includes('##')) {
    const [waitText, durationText] = trimmed.split('##');
    const waitMs = parseWait(waitText ?? '', bpm);
    const lastMs = parseDurationPart(durationText ?? '', bpm);
    if (lastMs === null) return null;
    return { waitMs, lastMs, hasExplicitWait: true };
  }

  // [#seconds]
  if (trimmed.startsWith('#')) {
    const seconds = Number(trimmed.slice(1));
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return { waitMs: isSlide ? 0 : 0, lastMs: seconds * 1000, hasExplicitWait: isSlide };
  }

  // [bpm#q:m]
  const withBpm = /^([0-9]+(?:\.[0-9]+)?)#(.+)$/.exec(trimmed);
  if (withBpm) {
    const localBpm = Number(withBpm[1]);
    const lastMs = parseMeasurePart(withBpm[2]!, localBpm);
    if (lastMs === null) return null;
    return {
      waitMs: isSlide ? beatMs(localBpm) : 0,
      lastMs,
      hasExplicitWait: isSlide,
    };
  }

  // [q:m]
  const lastMs = parseMeasurePart(trimmed, bpm);
  if (lastMs === null) return null;
  return {
    waitMs: isSlide ? beatMs(bpm) : 0,
    lastMs,
    hasExplicitWait: isSlide,
  };
}

function parseWait(value: string, bpm: number): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 0;
  if (trimmed.startsWith('#')) {
    const seconds = Number(trimmed.slice(1));
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  const withBpm = /^([0-9]+(?:\.[0-9]+)?)#(.+)$/.exec(trimmed);
  if (withBpm) {
    const parsed = parseMeasurePart(withBpm[2]!, Number(withBpm[1]));
    return parsed ?? 0;
  }
  const parsed = parseMeasurePart(trimmed, bpm);
  return parsed ?? 0;
}

function parseDurationPart(value: string, bpm: number): number | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const seconds = Number(trimmed.slice(1));
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const withBpm = /^([0-9]+(?:\.[0-9]+)?)#(.+)$/.exec(trimmed);
  if (withBpm) {
    return parseMeasurePart(withBpm[2]!, Number(withBpm[1]));
  }
  return parseMeasurePart(trimmed, bpm);
}

function parseMeasurePart(value: string, bpm: number): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?)$/.exec(value.trim());
  if (!match) return null;
  const quaver = Number(match[1]);
  const multiple = Number(match[2]);
  if (!Number.isFinite(quaver) || quaver <= 0 || !Number.isFinite(multiple)) return null;
  const beats = (4 / quaver) * multiple;
  return (60000 / bpm) * beats;
}

/* ------------------------------------------------------------------ */
/* maidata.txt                                                         */
/* ------------------------------------------------------------------ */

export interface MaidataLevel {
  index: number;
  levelText: string;
  body: string;
}

export interface MaidataFile {
  title: string;
  artist: string;
  charter: string;
  firstSeconds: number;
  wholeBpm: number;
  levels: MaidataLevel[];
}

export function parseMaidata(text: string): MaidataFile {
  const lines = text.replace(/\r/g, '').split('\n');
  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    fields.set(currentKey, currentValue.join('\n').trim());
  };

  for (const line of lines) {
    const header = /^&([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (header) {
      flush();
      currentKey = header[1]!;
      currentValue = [header[2]!];
    } else if (currentKey) {
      currentValue.push(line);
    }
  }
  flush();

  const levels: MaidataLevel[] = [];
  for (const [key, value] of fields) {
    const match = /^inote_(\d+)$/.exec(key);
    if (match) {
      levels.push({
        index: Number(match[1]),
        levelText: fields.get(`lv_${match[1]}`) ?? '',
        body: value,
      });
    }
  }
  levels.sort((a, b) => a.index - b.index);

  return {
    title: fields.get('title') ?? 'Untitled',
    artist: fields.get('artist') ?? 'Unknown',
    charter: fields.get('des_1') ?? fields.get('chart') ?? 'Unknown',
    firstSeconds: Number(fields.get('first') ?? '0') || 0,
    wholeBpm: Number(fields.get('wholebpm') ?? '0') || 0,
    levels,
  };
}

const DIFFICULTY_NAMES = ['Basic', 'Advanced', 'Expert', 'Master', 'Re:Master', 'Utage'];

export function difficultyName(index: number): string {
  return DIFFICULTY_NAMES[index - 1] ?? `Level ${index}`;
}
