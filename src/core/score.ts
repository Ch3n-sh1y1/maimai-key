import type { Judgment } from './types';

export type JudgmentCounts = Record<Judgment, number>;

interface GradeThreshold {
  name: string;
  min: number;
}

export const GRADES: GradeThreshold[] = [
  { name: 'SSS+', min: 100.5 },
  { name: 'SSS', min: 100 },
  { name: 'SS', min: 99 },
  { name: 'S', min: 97 },
  { name: 'AAA', min: 94 },
  { name: 'AA', min: 90 },
  { name: 'A', min: 80 },
  { name: 'BBB', min: 75 },
  { name: 'BB', min: 70 },
  { name: 'B', min: 65 },
  { name: 'C', min: 60 },
  { name: 'D', min: 0 },
];

export function gradeOf(achievement: number): string {
  for (const grade of GRADES) {
    if (achievement >= grade.min) return grade.name;
  }
  return 'D';
}

export function formatAchievement(achievement: number): string {
  return `${achievement.toFixed(4)}%`;
}

export function emptyCounts(): JudgmentCounts {
  return { critical: 0, perfect: 0, great: 0, good: 0, miss: 0 };
}

export function isFullCombo(counts: JudgmentCounts): boolean {
  return counts.good === 0 && counts.miss === 0;
}

export function isAllPerfect(counts: JudgmentCounts): boolean {
  return counts.great === 0 && counts.good === 0 && counts.miss === 0;
}
