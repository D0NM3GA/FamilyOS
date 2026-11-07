/**
 * Phase 59.3: one action on several items: the limits and the result. No zod here, so the client
 * bar can use it without shipping a validator; the input check is lib/work-items/bulk-schema.ts.
 */

/** Freshservice caps a bulk update at 30, and a family's list is never longer. */
export const BULK_MAX = 30;

/**
 * A bulk change is one transaction; a refusal is counted, but a database error fails the whole
 * batch and nothing is kept. Thirty items are a few hundred small queries, so it gets longer than
 * Prisma's default 5 seconds.
 */
export const BULK_TIMEOUT_MS = 15_000;

export type Reason = "not found" | "not allowed" | "already done" | "changed" | "can't move";

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
