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
  for (const r of rows) {
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
  return out;
}
