import { atMidnight } from "@/lib/tasks/schedule";

/** School's pure rules (Phase 18): overdue, class averages, ordering. No I/O. */

type Dated = { dueDate: Date | null };

/** Overdue is derived, never stored: still to do, and due before today. */
export function isOverdue(a: Dated & { status: string }, today = new Date()): boolean {
  return a.status === "TODO" && a.dueDate != null && a.dueDate < atMidnight(today);
}

/** Soonest first; undated last; stable by title. */
export function byDueDate<T extends Dated & { title: string }>(a: T, b: T): number {
  if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime() || a.title.localeCompare(b.title);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
}

export type ClassAverage = { className: string; percent: number; graded: number };

/**
 * Per-class average as total points over total possible (so a 50-point test weighs more
 * than a 10-point quiz, the way most gradebooks do it without categories). Only scored
 * work counts; classes are grouped case-insensitively.
 */
export function classAverages(assignments: { className: string; score: number | null; maxScore: number | null }[]): ClassAverage[] {
  const groups = new Map<string, { className: string; score: number; max: number; graded: number }>();
  for (const a of assignments) {
    if (a.score == null || a.maxScore == null || a.maxScore <= 0) continue;
    const key = a.className.trim().toLowerCase();
    const g = groups.get(key) ?? { className: a.className.trim(), score: 0, max: 0, graded: 0 };
    g.score += a.score;
    g.max += a.maxScore;
    g.graded++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ className: g.className, percent: Math.round((g.score / g.max) * 1000) / 10, graded: g.graded }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

