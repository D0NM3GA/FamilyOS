import { z } from "zod";

/**
 * Phase 59.3: one action on several items. The input is checked here (pure, so it's tested on its
 * own); each domain's bulk action runs its per-item core over the ids in one transaction.
 */

/** Freshservice caps a bulk update at 30, and a family's list is never longer. */
export const BULK_MAX = 30;

export type Reason = "not found" | "not allowed" | "already done" | "changed" | "can't move";

export function bulkSchema<A extends readonly [string, ...string[]]>(actions: A) {
  return z.object({
    ids: z
      .array(z.string().min(1).max(64))
      .min(1, "Pick at least one.")
      .max(BULK_MAX, `At most ${BULK_MAX} at a time.`)
      .transform((ids) => [...new Set(ids)]),
    action: z.enum(actions),
    value: z.string().max(64).optional(),
  });
}

export type BulkResult = { done: number; skipped: number; reasons: Partial<Record<Reason, number>>; milestone?: number | null };

export function summarize(results: ({ ok: true; milestone?: number | null } | { ok: false; reason: Reason })[]): BulkResult {
  const out: BulkResult = { done: 0, skipped: 0, reasons: {} };
  for (const r of results) {
    if (r.ok) {
      out.done++;
      // The highest crossed is the one worth a celebration.
      if (r.milestone && (!out.milestone || r.milestone > out.milestone)) out.milestone = r.milestone;
    } else {
      out.skipped++;
      out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1;
    }
  }
  return out;
}

const REASON_WORDS: Record<Reason, string> = {
  "not found": "gone",
  "not allowed": "not yours to change",
  "already done": "already that way",
  changed: "changed meanwhile",
  "can't move": "can't move there (a daily chore, or that day's taken)",
};

/** "Done 4, skipped 1 (already that way)". */
export function bulkMessage(r: BulkResult, verb = "Done"): string {
  const why = Object.entries(r.reasons)
    .map(([reason, n]) => `${n} ${REASON_WORDS[reason as Reason]}`)
    .join(", ");
  return r.skipped === 0 ? `${verb} ${r.done}.` : `${verb} ${r.done}, skipped ${r.skipped} (${why}).`;
}
