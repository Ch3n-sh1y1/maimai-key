import type { Judgment } from './types';

export interface JudgeWindows {
  /** CRITICAL PERFECT */
  critical: number;
  perfect: number;
  great: number;
  good: number;
}

export type JudgePresetName = 'keyboard' | 'standard' | 'strict';

export interface JudgePreset {
  label: string;
  windows: JudgeWindows;
  holdGraceMs: number;
}

/**
 * Timing windows are placeholders until verified against community data.
 * They are fully configurable in settings, so tuning them does not require a
 * code change.
 */
export const JUDGE_PRESETS: Record<JudgePresetName, JudgePreset> = {
  keyboard: {
    label: '键盘友好',
    windows: { critical: 32, perfect: 64, great: 110, good: 160 },
    holdGraceMs: 120,
  },
  standard: {
    label: '标准',
    windows: { critical: 25, perfect: 50, great: 100, good: 150 },
    holdGraceMs: 90,
  },
  strict: {
    label: '严格',
    windows: { critical: 20, perfect: 40, great: 80, good: 130 },
    holdGraceMs: 60,
  },
};

export const DEFAULT_JUDGE_PRESET: JudgePresetName = 'keyboard';

export const NOTE_WEIGHTS: Record<Judgment, number> = {
  critical: 1.01,
  perfect: 1.0,
  great: 0.8,
  good: 0.5,
  miss: 0,
};

export const DEFAULT_COMBO_BREAK: Judgment[] = ['miss'];

export const JUDGMENT_COLORS: Record<Judgment, string> = {
  critical: '#ffd166',
  perfect: '#7ce0ff',
  great: '#9be15d',
  good: '#ffb347',
  miss: '#ff6b6b',
};

export const JUDGMENT_LABELS: Record<Judgment, string> = {
  critical: 'CRITICAL',
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  miss: 'MISS',
};

export const JUDGMENT_ORDER: Judgment[] = ['critical', 'perfect', 'great', 'good', 'miss'];
