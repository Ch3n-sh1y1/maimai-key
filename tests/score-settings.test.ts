import { describe, expect, it } from 'vitest';
import { formatAchievement, gradeOf, isAllPerfect, isFullCombo } from '../src/core/score';
import { DEFAULT_KEYS, DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';

describe('gradeOf', () => {
  it('maps achievement thresholds', () => {
    expect(gradeOf(101)).toBe('SSS+');
    expect(gradeOf(100.5)).toBe('SSS+');
    expect(gradeOf(100.4999)).toBe('SSS');
    expect(gradeOf(99)).toBe('SS');
    expect(gradeOf(97)).toBe('S');
    expect(gradeOf(94)).toBe('AAA');
    expect(gradeOf(0)).toBe('D');
  });

  it('formats achievement with four decimals', () => {
    expect(formatAchievement(98.76543)).toBe('98.7654%');
  });
});

describe('combo badges', () => {
  it('detects full combo and all perfect', () => {
    const base = { critical: 10, perfect: 2, great: 1, good: 0, miss: 0 };
    expect(isFullCombo(base)).toBe(true);
    expect(isAllPerfect(base)).toBe(false);
    expect(isAllPerfect({ ...base, great: 0 })).toBe(true);
    expect(isFullCombo({ ...base, good: 1 })).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('falls back to defaults for garbage input', () => {
    const settings = sanitizeSettings('nonsense');
    expect(settings.keys).toEqual(DEFAULT_KEYS);
    expect(settings.judgePreset).toBe('keyboard');
  });

  it('keeps valid overrides and clamps numbers', () => {
    const settings = sanitizeSettings({
      judgePreset: 'strict',
      slideMode: 'auto',
      offsets: { audioMs: 9999, inputMs: -20, visualMs: 0 },
      approachSeconds: 0.1,
      volume: 5,
      keys: { KeyA: 5, KeyS: 6, KeyD: 7, KeyF: 8, KeyJ: 1, KeyK: 2, KeyL: 3, Semicolon: 4 },
    });
    expect(settings.judgePreset).toBe('strict');
    expect(settings.slideMode).toBe('auto');
    expect(settings.offsets.audioMs).toBe(500);
    expect(settings.offsets.inputMs).toBe(-20);
    expect(settings.approachSeconds).toBe(0.7);
    expect(settings.volume).toBe(1);
  });

  it('rejects incomplete key maps', () => {
    const settings = sanitizeSettings({ keys: { KeyA: 1 } });
    expect(settings.keys).toEqual(DEFAULT_SETTINGS.keys);
  });

  it('accepts only known HUD presets', () => {
    expect(sanitizeSettings({ hudPreset: 'pro' }).hudPreset).toBe('pro');
    expect(sanitizeSettings({ hudPreset: 'beginner' }).hudPreset).toBe('beginner');
    expect(sanitizeSettings({ hudPreset: 'ultra' }).hudPreset).toBe('normal');
    expect(DEFAULT_SETTINGS.hudPreset).toBe('normal');
  });

  it('keeps the input mode and note direction safe', () => {
    expect(DEFAULT_SETTINGS.inputMode).toBe('keyboard');
    expect(DEFAULT_SETTINGS.noteDirection).toBe('down');
    expect(sanitizeSettings({ inputMode: 'touch', noteDirection: 'up' })).toMatchObject({
      inputMode: 'touch',
      noteDirection: 'up',
    });
    expect(sanitizeSettings({ inputMode: 'trackpad', noteDirection: 'sideways' })).toMatchObject({
      inputMode: 'keyboard',
      noteDirection: 'down',
    });
  });

  it('uses the slower default and migrates the old 1.35s default once', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(2);
    expect(DEFAULT_SETTINGS.approachSeconds).toBe(2);
    expect(sanitizeSettings({ schemaVersion: 1, approachSeconds: 1.35 }).approachSeconds).toBe(2);
    expect(sanitizeSettings({ schemaVersion: 2, approachSeconds: 1.35 }).approachSeconds).toBe(1.35);
    expect(sanitizeSettings({ approachSeconds: 9 }).approachSeconds).toBe(4);
  });
});
