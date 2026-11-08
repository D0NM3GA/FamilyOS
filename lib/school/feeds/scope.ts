import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Phase 70f: which school feeds someone sees. A kid (or a grown-up looking at one kid) gets the
 * family's feeds and the ones they're on; a grown-up looking at everyone gets every feed, including
 * one that's for nobody yet (its last kid was deleted).
 */
export function feedScope(studentId: string | null | undefined): Prisma.SchoolFeedWhereInput {
  return studentId ? { OR: [{ forFamily: true }, { kids: { some: { personId: studentId } } }] } : {};
}

/** What a feed row needs to say who it's for. */
export const FEED_WHO = { forFamily: true, name: true, kids: { select: { person: { select: { id: true, firstName: true } } } } } as const;

export type FeedWho = { forFamily: boolean; name: string; kids: { person: { id: string; firstName: string } }[] };

/** The kids a feed is for (none when it's the family's), first names in order. */
export function feedKids(f: FeedWho): { ids: string[]; names: string[] } {
  if (f.forFamily) return { ids: [], names: [] };
  const kids = [...f.kids].sort((a, b) => a.person.firstName.localeCompare(b.person.firstName));
  return { ids: kids.map((k) => k.person.id), names: kids.map((k) => k.person.firstName) };
}

/** "Ivy & Max", "Whole family", or "Nobody's yet". */
export function feedForWords(f: FeedWho): string {
  if (f.forFamily) return "Whole family";
  const { names } = feedKids(f);
  return names.length ? names.join(" & ") : "Nobody's yet";
}
