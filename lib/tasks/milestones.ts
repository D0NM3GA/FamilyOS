/**
 * Count-based milestones, not date-consecutive streaks — a streak punishes a single missed
 * or skipped day, while a running total only ever goes up. Chores-only, total across every
 * chore definition — not per-definition ("50th trash night" is a different, later idea) and
 * not combined with Meds (a med-adherence count is a different feature; this phase is
 * Chores). Counted from PointsLedger rows credited to a person for a CHORE-domain instance
 * — see app/(app)/chores/actions.ts's completeInstance, which is also points' own definition
 * of "who this completion belongs to," so the two can't disagree.
 */
export const MILESTONES = [10, 25, 50, 100, 250, 500] as const;

/** The milestone just reached by going from `before` to `after` completions, or null if
 * none was crossed (including the — impossible in practice, since completions increment by
 * one — case of skipping past one entirely, handled defensively by checking `<= after`
 * rather than `=== after`). */
export function milestoneCrossed(before: number, after: number): number | null {
  for (const m of MILESTONES) {
    if (before < m && after >= m) return m;
  }
  return null;
}

/** The next milestone still ahead of `count`, or null once past the last one. */
export function nextMilestone(count: number): number | null {
  return MILESTONES.find((m) => m > count) ?? null;
}
