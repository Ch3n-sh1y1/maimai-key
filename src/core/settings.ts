import type { JudgePresetName } from './balance';
import { DEFAULT_JUDGE_PRESET, JUDGE_PRESETS } from './balance';

export type SlideMode = 'waypoint' | 'auto';
export type HudPreset = 'beginner' | 'normal' | 'pro';
export type InputMode = 'keyboard' | 'touch';
export type NoteDirection = 'down' | 'up';

export type Language = 'zh-CN' | 'en';

export interface Offsets {
  /** Positive = the chart is shifted later relative to the audio. */
  audioMs: number;
  /** Positive = keyboard input is considered later (compensation). */
  inputMs: number;
  /** Positive = notes are drawn later on screen. */
  visualMs: number;
}

export interface GameSettings {
  schemaVersion: 2;
  /** KeyboardEvent.code -> sector (1..8). */
  keys: Record<string, number>;
  judgePreset: JudgePresetName;
  slideMode: SlideMode;
  offsets: Offsets;
  /** Approach time in seconds (how long a note stays visible). */
  approachSeconds: number;
  volume: number;
  sfxVolume: number;
  fpsCap: number;
  fullscreen: boolean;
  language: Language;
  showKeyHints: boolean;
  showFastLate: boolean;
  hudPreset: HudPreset;
  /** Keyboard uses the horizontal piano field; touch uses eight ring sectors. */
  inputMode: InputMode;
  /** Direction notes travel toward the judgment line in piano mode. */
  noteDirection: NoteDirection;
}

/** Unrolled clockwise from button 5 so the row reads as 5 6 7 8 1 2 3 4. */
export const DEFAULT_KEYS: Record<string, number> = {
  KeyA: 5,
  KeyS: 6,
  KeyD: 7,
  KeyF: 8,
  KeyJ: 1,
  KeyK: 2,
  KeyL: 3,
  Semicolon: 4,
};

export const KEY_PRESETS: Record<string, { label: string; keys: Record<string, number> }> = {
  unrolled: { label: '默认（滚轮展开 A S D F / J K L ;）', keys: DEFAULT_KEYS },
  compact: {
    label: '紧凑（S D F G / H J K L）',
    keys: { KeyS: 5, KeyD: 6, KeyF: 7, KeyG: 8, KeyH: 1, KeyJ: 2, KeyK: 3, KeyL: 4 },
  },
  home: {
    label: '主键区（D F G H / J K L ;）',
    keys: { KeyD: 5, KeyF: 6, KeyG: 7, KeyH: 8, KeyJ: 1, KeyK: 2, KeyL: 3, Semicolon: 4 },
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  schemaVersion: 2,
  keys: { ...DEFAULT_KEYS },
  judgePreset: DEFAULT_JUDGE_PRESET,
  slideMode: 'waypoint',
  offsets: { audioMs: 0, inputMs: 0, visualMs: 0 },
  approachSeconds: 2,
  volume: 0.8,
  sfxVolume: 0.7,
  fpsCap: 240,
  fullscreen: false,
  language: 'zh-CN',
  showKeyHints: true,
  showFastLate: true,
  hudPreset: 'normal',
  inputMode: 'keyboard',
  noteDirection: 'down',
};

export function judgeWindowsOf(settings: GameSettings) {
  return JUDGE_PRESETS[settings.judgePreset].windows;
}

export function cloneSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    keys: { ...settings.keys },
    offsets: { ...settings.offsets },
  };
}

export function sanitizeSettings(input: unknown): GameSettings {
  const base = cloneSettings(DEFAULT_SETTINGS);
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<GameSettings>;

  if (raw.keys && typeof raw.keys === 'object') {
    const keys: Record<string, number> = {};
    for (const [code, sector] of Object.entries(raw.keys)) {
      if (typeof code === 'string' && Number.isInteger(sector) && sector >= 1 && sector <= 8) {
        keys[code] = sector;
      }
    }
    if (Object.keys(keys).length === 8) base.keys = keys;
  }
  if (raw.judgePreset && raw.judgePreset in JUDGE_PRESETS) base.judgePreset = raw.judgePreset;
  if (raw.slideMode === 'waypoint' || raw.slideMode === 'auto') base.slideMode = raw.slideMode;
  if (raw.offsets && typeof raw.offsets === 'object') {
    const offsets = raw.offsets as Partial<Offsets>;
    base.offsets = {
      audioMs: clamp(Number(offsets.audioMs ?? 0), -500, 500),
      inputMs: clamp(Number(offsets.inputMs ?? 0), -500, 500),
      visualMs: clamp(Number(offsets.visualMs ?? 0), -500, 500),
    };
  }
  if (typeof raw.approachSeconds === 'number') {
    // 0.3.0 shipped with a 1.35 s default that felt too fast. Migrate that
    // exact old default once; an explicitly chosen value is preserved.
    const migrated = (raw.schemaVersion as number | undefined) === 1 && raw.approachSeconds === 1.35
      ? 2
      : raw.approachSeconds;
    base.approachSeconds = clamp(migrated, 0.7, 4);
  }
  if (typeof raw.volume === 'number') base.volume = clamp(raw.volume, 0, 1);
  if (typeof raw.sfxVolume === 'number') base.sfxVolume = clamp(raw.sfxVolume, 0, 1);
  if (typeof raw.fpsCap === 'number') base.fpsCap = clamp(raw.fpsCap, 60, 480);
  if (typeof raw.fullscreen === 'boolean') base.fullscreen = raw.fullscreen;
  if (raw.language === 'zh-CN' || raw.language === 'en') base.language = raw.language;
  if (typeof raw.showKeyHints === 'boolean') base.showKeyHints = raw.showKeyHints;
  if (typeof raw.showFastLate === 'boolean') base.showFastLate = raw.showFastLate;
  if (raw.hudPreset === 'beginner' || raw.hudPreset === 'normal' || raw.hudPreset === 'pro') {
    base.hudPreset = raw.hudPreset;
  }
  if (raw.inputMode === 'keyboard' || raw.inputMode === 'touch') base.inputMode = raw.inputMode;
  if (raw.noteDirection === 'down' || raw.noteDirection === 'up') base.noteDirection = raw.noteDirection;
  return base;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
