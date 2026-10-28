import type { GameSettings } from '../core/settings';
import { sanitizeSettings } from '../core/settings';
import type { JudgmentCounts } from '../core/score';
import type { Replay } from '../core/replay';

const SETTINGS_KEY = 'maimai-key/settings/v1';
const SCORES_KEY = 'maimai-key/scores/v1';
const REPLAYS_KEY = 'maimai-key/replays/v1';

export interface ScoreEntry {
  achievement: number;
  grade: string;
  counts: JudgmentCounts;
  maxCombo: number;
  isAllPerfect: boolean;
  isFullCombo: boolean;
  plays: number;
  updatedAt: number;
  assisted: boolean;
}

export type ScoreBook = Record<string, Record<string, ScoreEntry>>;

export const STORAGE_ISSUE_EVENT = 'maimai:storage-issue';

function reportStorageIssue(message: string, error: unknown): void {
  console.warn(message, error);
  window.dispatchEvent(new CustomEvent<string>(STORAGE_ISSUE_EVENT, { detail: message }));
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return sanitizeSettings(null);
    return sanitizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn('settings load failed', error);
    return sanitizeSettings(null);
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    reportStorageIssue('设置保存失败，可能是磁盘空间不足。', error);
  }
}

export function loadScores(): ScoreBook {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ScoreBook;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function scoreKey(packId: string, difficulty: string): [string, string] {
  return [packId, difficulty];
}

export function getScore(book: ScoreBook, packId: string, difficulty: string): ScoreEntry | undefined {
  return book[packId]?.[difficulty];
}

export function recordScore(
  book: ScoreBook,
  packId: string,
  difficulty: string,
  entry: Omit<ScoreEntry, 'plays' | 'updatedAt'>,
): ScoreBook {
  const next: ScoreBook = { ...book, [packId]: { ...(book[packId] ?? {}) } };
  const previous = next[packId]?.[difficulty];
  const improved = !previous || entry.achievement > previous.achievement;
  next[packId]![difficulty] = {
    ...(improved ? entry : previous),
    plays: (previous?.plays ?? 0) + 1,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('score save failed', error);
    reportStorageIssue('成绩保存失败，可能是存储空间不足。', error);
  }
  return next;
}

export function loadReplays(): Replay[] {
  try {
    const raw = localStorage.getItem(REPLAYS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Replay[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.version === 1) : [];
  } catch {
    return [];
  }
}

export function saveReplay(replay: Replay): Replay[] {
  const next = [replay, ...loadReplays()].slice(0, 20);
  try {
    localStorage.setItem(REPLAYS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('replay save failed', error);
    reportStorageIssue('回放保存失败，可能是存储空间不足。', error);
  }
  return next;
}
