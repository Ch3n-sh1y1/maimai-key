/**
 * Core data model for the game. Everything in `src/core` is engine-agnostic and
 * must stay runnable in plain Node (unit tests) without DOM or Electron APIs.
 */

export type Judgment = 'critical' | 'perfect' | 'great' | 'good' | 'miss';

export type NoteKind = 'tap' | 'hold' | 'slide' | 'touch' | 'touchHold';

/** Simai slide stroke shapes. */
export type SlideShape =
  | '-'
  | '<'
  | '>'
  | '^'
  | 'v'
  | 'p'
  | 'q'
  | 's'
  | 'z'
  | 'w'
  | 'pp'
  | 'qq'
  | 'V';

/** One stroke of a (possibly chained) slide. */
export interface SlideSpec {
  shape: SlideShape;
  /** Ending button, 1..8. */
  to: number;
  /** Inflection button for `V`-type slides. */
  inflection?: number;
  /** Time spent traveling this stroke, in ms. */
  durationMs: number;
}

export interface Note {
  id: number;
  kind: NoteKind;
  /** Head timing relative to audio start, in ms. */
  timeMs: number;
  /** Button number 1..8 (slide start for slides). */
  sector: number;
  /** Hold tail / slide completion time, in ms. */
  endMs: number;
  isBreak: boolean;
  isEx: boolean;
  /** Touch sensors A-F when the note came from a touch notation. */
  sensor?: string;
  /** Slide chain; empty for non-slides. */
  slide?: SlideSpec[];
  /** Delay between slide head and the trace starting to move. */
  slideWaitMs?: number;
}

export interface ChartMeta {
  title: string;
  artist: string;
  charter: string;
  bpm: number;
  /** Global chart offset in ms (positive = notes happen later). */
  audioOffsetMs: number;
  difficultyName: string;
  level: number;
}

export interface Chart {
  schemaVersion: 1;
  meta: ChartMeta;
  notes: Note[];
  durationMs: number;
  warnings: string[];
}

export interface PackDifficulty {
  name: string;
  level: number;
  chart: string;
}

export interface PackManifest {
  schema: 1;
  id: string;
  title: string;
  artist: string;
  charter: string;
  bpm: number;
  audioOffsetMs: number;
  audio: string;
  jacket?: string;
  difficulties: PackDifficulty[];
}

export interface ContentPack extends PackManifest {
  root: string;
}
