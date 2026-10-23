import { atMidnight } from "@/lib/tasks/schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
// A single interval isn't a cadence, it's a guess — milk bought Monday then Thursday
// because you ran out early shouldn't read as "every 3 days" forever. Two intervals (three
// distinct purchase days) is the minimum for a median to mean anything.
const MIN_DISTINCT_DAYS = 3;
// Beyond this many cadence-lengths of silence, assume the item was a one-off, seasonal, or
// abandoned rather than "still due" — without a ceiling, anything ever bought three times
// stays flagged forever. A weekly item nags for ~3 weeks past due, then gives up; a
// monthly one for ~3 months.
const STALE_MULTIPLIER = 3;

export type PurchaseHistoryRow = {
  /** Same key convention as lib/groceries/queries.ts's getRecentlyBought (productId, else
   * productId ?? description.toLowerCase(). */
  key: string;
  label: string;
  productId: string | null;
  purchasedAt: Date;
};

export type PantrySuggestion = {
  key: string;
  label: string;
  /** Carried through so a caller can add it back exactly like getRecentlyBought's own rows
   * do (`productId ? {productId} : {name: label}`) — `key` alone can't tell a real
   * Product id apart from an old history row's lowercased description. */
  productId: string | null;
  daysSinceLast: number;
  medianIntervalDays: number;
};

export function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Returns null for an invalid Date rather than NaN — Prisma can never hand back an invalid
 * DateTime, but this is an exported, injected-`now` pure function anyone could call with a
 * bad fixture or a future caller could feed bad data, and an unguarded NaN slips past every
 * numeric comparison below (NaN < x, NaN > x, and NaN <= x are all false), silently
 * corrupting the ranking sort and rendering as "~NaN days" in the UI. */
export function dayNumber(d: Date): number | null {
  const t = atMidnight(d).getTime();
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/**
 * Which purchased items are "probably due" again, based on how regularly they've been
 * bought in the past — distinct from a flat "recently bought" list (no cadence awareness).
 * Pure, no Prisma: `now` and the row list are both injected, same pattern as
 * lib/people.ts's pickStaleContacts, so this is testable without a database.
 */
export function computePantrySuggestions(
  rows: PurchaseHistoryRow[],
  now: Date,
  opts: { excludeKeys?: Set<string>; limit?: number } = {},
): PantrySuggestion[] {
  const { excludeKeys, limit = 8 } = opts;
  const today = dayNumber(now);
  if (today == null) return []; // an invalid `now` can't produce a meaningful "days since"

  // Collapse to distinct calendar days per key first — two trips in one day, or the same
  // item twice in one trip, is one data point, not two. This also structurally rules out a
  // zero-day interval rather than needing to special-case it below.
  const byKey = new Map<string, { label: string; productId: string | null; days: Set<number> }>();
  for (const row of rows) {
    if (excludeKeys?.has(row.key)) continue;
    const day = dayNumber(row.purchasedAt);
    if (day == null) continue; // an invalid purchase date can't contribute a data point
    const entry = byKey.get(row.key);
    if (entry) {
      entry.days.add(day);
    } else {
      byKey.set(row.key, { label: row.label, productId: row.productId, days: new Set([day]) });
    }
  }

  const suggestions: PantrySuggestion[] = [];

  for (const [key, { label, productId, days }] of byKey) {
    if (days.size < MIN_DISTINCT_DAYS) continue;

    const sortedDays = [...days].sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < sortedDays.length; i++) intervals.push(sortedDays[i] - sortedDays[i - 1]);

    const medianIntervalDays = median(intervals);
    if (medianIntervalDays <= 0) continue;

    const daysSinceLast = today - sortedDays[sortedDays.length - 1];
    if (daysSinceLast < medianIntervalDays) continue;
    if (daysSinceLast > medianIntervalDays * STALE_MULTIPLIER) continue;

    suggestions.push({ key, label, productId, daysSinceLast, medianIntervalDays });
  }

  return suggestions
    .sort((a, b) => b.daysSinceLast / b.medianIntervalDays - a.daysSinceLast / a.medianIntervalDays)
    .slice(0, limit);
}
