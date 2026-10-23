/**
 * Fill-up MPG, computed at read time — same semantics as LubeLogger's own
 * Helper/GasHelper.cs (verified against its source during Phase 12's scope review):
 * - MPG is only computed on a full-tank fill, over the miles since the previous full-tank
 *   "anchor", divided by every gallon added since that anchor (this fill plus any partial
 *   fills in between).
 * - A `missedPrevious` fill gets no MPG (the gallons for the gap were never logged) and
 *   resets the running total; if it's itself a full fill, it becomes the next anchor.
 * - Ordered by mileage, not date: a fill-up is a point on the odometer.
 *
 * A segment with non-positive miles or gallons (a mistyped mileage) gets no MPG and is
 * flagged `anomaly` rather than rejected at entry time — one fat-fingered row shouldn't
 * block every later fill-up from being logged (see docs/BUILD.md Phase 12).
 */

export type FuelEntry = {
  id: string;
  mileage: number;
  gallons: number;
  fullTank: boolean;
  missedPrevious: boolean;
};

export type EntryMpg = { mpg: number | null; anomaly: boolean };

export type MpgSummary = {
  perEntry: Map<string, EntryMpg>;
  /** Total miles / total gallons over computable segments only; null if there are none. */
  averageMpg: number | null;
  totalMiles: number;
  totalGallons: number;
};

export function computeMpg(entries: readonly FuelEntry[]): MpgSummary {
  // Stable sort: ties on mileage keep the caller's order (the query orders by filledAt).
  const sorted = [...entries].sort((a, b) => a.mileage - b.mileage);
  const perEntry = new Map<string, EntryMpg>();

  let anchor: number | null = null;
  let gallonsSinceAnchor = 0;
  let totalMiles = 0;
  let totalGallons = 0;

  for (const entry of sorted) {
    if (entry.missedPrevious || anchor == null) {
      perEntry.set(entry.id, { mpg: null, anomaly: false });
      gallonsSinceAnchor = 0;
      anchor = entry.fullTank ? entry.mileage : null;
      continue;
    }

    gallonsSinceAnchor += entry.gallons;
    if (!entry.fullTank) {
      perEntry.set(entry.id, { mpg: null, anomaly: false });
      continue;
    }

    const miles = entry.mileage - anchor;
    if (miles <= 0 || gallonsSinceAnchor <= 0) {
      perEntry.set(entry.id, { mpg: null, anomaly: true });
    } else {
      perEntry.set(entry.id, { mpg: miles / gallonsSinceAnchor, anomaly: false });
      totalMiles += miles;
      totalGallons += gallonsSinceAnchor;
    }
    anchor = entry.mileage;
    gallonsSinceAnchor = 0;
  }

  return {
    perEntry,
    averageMpg: totalGallons > 0 ? totalMiles / totalGallons : null,
    totalMiles,
    totalGallons,
  };
}
