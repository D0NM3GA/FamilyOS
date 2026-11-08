import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { shortNames } from "@/lib/people";
import { isAdult, type RoleBearing } from "@/lib/roles";
import type { CalendarEvent, CalendarEventsResult } from "@/lib/graph/calendar";

/**
 * Phase 70a: who sees which copied Outlook events (the owner's call): grown-ups see every copied
 * calendar; a kid sees the family calendar and their own. A private event shows as "Busy" to
 * everyone but its calendar's person (who sees "Private": its title is never stored).
 */

export type CopiedRow = {
  calendarId: string;
  kind: "PERSON" | "FAMILY";
  personId: string;
  graphId: string;
  iCalUId: string | null;
  title: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  isPrivate: boolean;
};

export type Viewer = { id: string; adult: boolean };

/** Whether this viewer may see this calendar's events at all. */
export function canSeeCalendar(kind: CopiedRow["kind"], personId: string, viewer: Viewer): boolean {
  return kind === "FAMILY" || viewer.adult || personId === viewer.id;
}

/**
 * The rows a viewer may see, as calendar events, soonest first. The same meeting in the family
 * calendar and someone's own (or in two people's own) shows once: matched by iCalUId, start and
 * all-day. The family copy wins (it's everyone's); otherwise the names are joined. Pure.
 */
export function shapeCopiedEvents(rows: readonly CopiedRow[], viewer: Viewer, names: ReadonlyMap<string, string>): CalendarEvent[] {
  type Acc = { event: CalendarEvent; family: boolean; people: string[] };
  const byMeeting = new Map<string, Acc>();
  const out: Acc[] = [];
  for (const r of rows) {
    if (!canSeeCalendar(r.kind, r.personId, viewer)) continue;
    const mine = r.personId === viewer.id;
    const title = r.isPrivate ? (mine ? "Private" : "Busy") : (r.title ?? "(No subject)");
    const person = r.kind === "PERSON" ? r.personId : null;
    const key = r.iCalUId ? `${r.iCalUId}|${r.startsAt.getTime()}|${r.allDay}` : null;
    const seen = key ? byMeeting.get(key) : undefined;
    if (seen) {
      if (r.kind === "FAMILY") seen.family = true;
      else if (person && !seen.people.includes(person)) seen.people.push(person);
      // A private copy and a public copy of one meeting: show the title someone may see.
      if (seen.event.subject === "Busy" || seen.event.subject === "Private") {
        if (!r.isPrivate) seen.event = { ...seen.event, subject: title, location: r.location };
      }
      continue;
    }
    const acc: Acc = {
      event: {
        id: `${r.calendarId}:${r.graphId}`,
        subject: title,
        start: r.startsAt,
        end: r.endsAt,
        isAllDay: r.allDay,
        location: r.isPrivate ? null : r.location,
        webLink: null,
      },
      family: r.kind === "FAMILY",
      people: person ? [person] : [],
    };
    if (key) byMeeting.set(key, acc);
    out.push(acc);
  }
  return out
    .map(({ event, family, people }) => {
      if (family || people.length === 0) return { ...event, who: null, whoId: null };
      const who = people.map((p) => names.get(p) ?? "").filter(Boolean).join(" & ") || null;
      return { ...event, who, whoId: people.length === 1 ? people[0] : null };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Whether the household copies any Outlook calendar: then Home and Calendar read only the copy. */
export const hasOutlookCopy = cache(async (householdId: string): Promise<boolean> => {
  const n = await prisma.outlookCalendar.count({ where: { householdId, active: true } });
  return n > 0;
});

type Profile = RoleBearing & { id: string; householdId: string };

/** The copied events overlapping [start, end) this profile may see. */
export async function getCopiedEvents(profile: Profile, range: { start: Date; end: Date }, opts: { max?: number } = {}): Promise<CalendarEventsResult> {
  const viewer: Viewer = { id: profile.id, adult: isAdult(profile) };
  const calendars = await prisma.outlookCalendar.findMany({
    where: {
      householdId: profile.householdId,
      active: true,
      person: { isHouseholdMember: true, entraAccessEndedAt: null },
      ...(viewer.adult ? {} : { OR: [{ kind: "FAMILY" as const }, { personId: viewer.id }] }),
    },
    select: { id: true, kind: true, personId: true, person: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (calendars.length === 0) return { ok: true, events: [], truncated: false };
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const rows = await prisma.outlookEvent.findMany({
    where: { outlookCalendarId: { in: calendars.map((c) => c.id) }, startsAt: { lt: range.end }, endsAt: { gt: range.start } },
    orderBy: { startsAt: "asc" },
    take: 1000,
  });
  const names = shortNames(calendars.map((c) => c.person));
  const shaped = shapeCopiedEvents(
    rows.map((r) => {
      const c = byId.get(r.outlookCalendarId)!;
      return { calendarId: c.id, kind: c.kind, personId: c.personId, ...r };
    }),
    viewer,
    names,
  );
  const max = opts.max ?? shaped.length;
  return { ok: true, events: shaped.slice(0, max), truncated: shaped.length > max };
}
