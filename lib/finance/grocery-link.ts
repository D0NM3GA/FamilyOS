/**
 * Phase 26: which grocery trip a Groceries charge paid for. Pure.
 *
 * Only trips saved by one of the jar's own members are candidates (Grandma's Kroger charge
 * must never pick up the family's Walmart trip). A trip's day is the server-local day it was
 * saved; a card charge posts that day or up to 4 days later (one day earlier allowed for a
 * pending row's date). A link is made only when it's one-to-one both ways: one candidate trip
 * for the charge AND one candidate charge for the trip. Otherwise a person picks.
 */

export type LinkTxn = { id: string; postedOn: string };
export type LinkTrip = { id: string; day: string };

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function fits(txnDay: string, tripDay: string): boolean {
  const diff = Math.round((toMs(txnDay) - toMs(tripDay)) / 86_400_000);
  return diff >= -1 && diff <= 4;
}

export function matchTrips(txns: LinkTxn[], trips: LinkTrip[]): [txnId: string, tripId: string][] {
  const tripsFor = new Map(txns.map((t) => [t.id, trips.filter((p) => fits(t.postedOn, p.day))]));
  const txnsFor = new Map(trips.map((p) => [p.id, txns.filter((t) => fits(t.postedOn, p.day))]));
  const out: [string, string][] = [];
  for (const t of txns) {
    const candidates = tripsFor.get(t.id)!;
    if (candidates.length !== 1) continue;
    if (txnsFor.get(candidates[0].id)!.length !== 1) continue;
    out.push([t.id, candidates[0].id]);
  }
  return out;
}

/** Server-local civil day of an instant (how a grocery trip's day is meant). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
