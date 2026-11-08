/**
 * Phase 70f: the same event from two feeds (a district's and a school's, or two kids' schools that
 * share a calendar) shows once, with every kid it's for. Same title (ignoring case and spacing),
 * start, end and all-day flag; anything else is a different event. A family feed's copy makes it
 * the family's. Pure.
 */

export type FoldableEvent = { title: string; startsAt: Date; endsAt: Date; allDay: boolean; family: boolean; whoIds: string[]; whoNames: string[] };

const keyOf = (e: FoldableEvent) => `${e.title.trim().replace(/\s+/g, " ").toLowerCase()}|${e.startsAt.getTime()}|${e.endsAt.getTime()}|${e.allDay}`;

export function foldFeedEvents<T extends FoldableEvent>(rows: readonly T[]): T[] {
  const out: T[] = [];
  const seen = new Map<string, T>();
  // A family feed's copy is folded into first, so its label and key are the ones kept whatever
  // order the rows came in; the result goes back to starting order.
  const ordered = [...rows].sort((a, b) => Number(b.family) - Number(a.family));
  for (const r of ordered) {
    const key = keyOf(r);
    const first = seen.get(key);
    if (!first) {
      const copy = { ...r, whoIds: [...r.whoIds], whoNames: [...r.whoNames] };
      seen.set(key, copy);
      out.push(copy);
      continue;
    }
    if (r.family) first.family = true;
    r.whoIds.forEach((id, i) => {
      if (first.whoIds.includes(id)) return;
      first.whoIds.push(id);
      first.whoNames.push(r.whoNames[i] ?? "");
    });
  }
  for (const e of out) {
    if (e.family) {
      e.whoIds = [];
      e.whoNames = [];
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
