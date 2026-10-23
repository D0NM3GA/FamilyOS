import { dayNumber, median } from "./pantry";

/**
 * What the family usually gets of one item, learned from its trips (Phase 22): how many per
 * trip and how often. Shown on the item sheet ("1 bag every ~5 weeks") and used as the
 * starting amount when the item goes back on the list. Pure, `rows` injected.
 */
export type Usual = { quantity: number; everyDays: number | null; trips: number };

// Recent trips say more about today's household than last year's do.
const RECENT_TRIPS = 5;

export function usualFor(rows: { quantity: number; purchasedAt: Date }[]): Usual | null {
  // One data point per day: two lines of the same item on one trip are one purchase.
  const byDay = new Map<number, number>();
  for (const r of rows) {
    const day = dayNumber(r.purchasedAt);
    if (day == null || !(r.quantity > 0)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + r.quantity);
  }
  if (byDay.size === 0) return null;

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const recent = days.slice(-RECENT_TRIPS);
  const quantity = Math.max(1, Math.round(median(recent.map((d) => byDay.get(d)!))));

  const intervals = days.slice(1).map((d, i) => d - days[i]);
  // Same rule as pantry.ts: one gap is a guess, two make a cadence.
  const everyDays = intervals.length >= 2 ? Math.round(median(intervals)) : null;

  return { quantity, everyDays, trips: days.length };
}

/** "every ~5 weeks", "every ~4 days", "about monthly" — or null without a cadence. */
export function describeEvery(everyDays: number | null): string | null {
  if (everyDays == null || everyDays <= 0) return null;
  if (everyDays < 12) return `every ~${everyDays} day${everyDays === 1 ? "" : "s"}`;
  if (everyDays >= 28 && everyDays <= 32) return "about monthly";
  if (everyDays < 70) return `every ~${Math.round(everyDays / 7)} weeks`;
  return `every ~${Math.round(everyDays / 30)} months`;
}
