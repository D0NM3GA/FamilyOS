import { prisma } from "@/lib/prisma";
import { shortNames } from "@/lib/people";
import { isAdult, type RoleBearing } from "@/lib/roles";
import { stillHere } from "./copy";

/**
 * Phase 70b: who's driving to a copied Outlook event. Grown-ups set it on a timed event; everyone
 * who can see the event sees it. Kept in the app only, never written to Outlook.
 */

type Profile = RoleBearing & { id: string; householdId: string };

export type DriveTarget = {
  calendarId: string;
  graphId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  driverId: string | null;
  iCalUId: string | null;
  /** The grown-ups who can drive, by the names the app shows. */
  drivers: { id: string; name: string }[];
};

/** Who can be a driver: the household's grown-ups who are still here. */
async function grownUps(householdId: string) {
  const people = await prisma.person.findMany({
    where: { householdId, ...stillHere, role: { in: ["ADULT", "ADMIN"] } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const names = shortNames(people);
  return people.map((p) => ({ id: p.id, name: names.get(p.id) ?? p.firstName }));
}

/**
 * One copied, timed event a grown-up may set a driver on: its calendar is this household's, copied,
 * and its person still here. Null for anything else (a kid, an all-day event, a gone event).
 */
export async function getDriveTarget(profile: Profile, calendarId: string, graphId: string): Promise<DriveTarget | null> {
  if (!isAdult(profile)) return null;
  const event = await prisma.outlookEvent.findFirst({
    where: {
      outlookCalendarId: calendarId,
      graphId,
      allDay: false,
      outlookCalendar: { householdId: profile.householdId, active: true, person: stillHere },
    },
    select: { title: true, isPrivate: true, startsAt: true, endsAt: true, iCalUId: true, outlookCalendar: { select: { personId: true } } },
  });
  if (!event) return null;
  const [driver, drivers] = await Promise.all([
    prisma.eventDriver.findUnique({ where: { outlookCalendarId_graphId: { outlookCalendarId: calendarId, graphId } }, select: { personId: true } }),
    grownUps(profile.householdId),
  ]);
  const mine = event.outlookCalendar.personId === profile.id;
  return {
    calendarId,
    graphId,
    iCalUId: event.iCalUId,
    title: event.isPrivate ? (mine ? "Private" : "Busy") : (event.title ?? "(No subject)"),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    driverId: driver && drivers.some((d) => d.id === driver.personId) ? driver.personId : null,
    drivers,
  };
}

export type SetDriverResult = { ok: true } | { ok: false; error: string };

/**
 * Every copy of one meeting in the household's copied calendars (the family calendar and people's
 * own share an iCalUId, start and all-day flag), so a driver set from any of them shows on all,
 * whichever one a viewer can see.
 */
async function copiesOf(householdId: string, target: DriveTarget): Promise<{ outlookCalendarId: string; graphId: string }[]> {
  if (!target.iCalUId) return [{ outlookCalendarId: target.calendarId, graphId: target.graphId }];
  const copies = await prisma.outlookEvent.findMany({
    where: { iCalUId: target.iCalUId, startsAt: target.startsAt, allDay: false, outlookCalendar: { householdId, active: true } },
    select: { outlookCalendarId: true, graphId: true },
  });
  return copies.some((c) => c.outlookCalendarId === target.calendarId && c.graphId === target.graphId) ? copies : [...copies, { outlookCalendarId: target.calendarId, graphId: target.graphId }];
}

/** Sets (or, with no one, clears) who's driving, on every copy of the meeting. Checks the event and the driver. */
export async function setEventDriver(profile: Profile, calendarId: string, graphId: string, driverId: string | null): Promise<SetDriverResult> {
  const target = await getDriveTarget(profile, calendarId, graphId);
  if (!target) return { ok: false, error: "That event isn't on the calendar anymore." };
  if (driverId && !target.drivers.some((d) => d.id === driverId)) return { ok: false, error: "Pick one of the family's grown-ups." };
  const copies = await copiesOf(profile.householdId, target);
  await prisma.$transaction(async (tx) => {
    for (const c of copies) {
      if (!driverId) {
        await tx.eventDriver.deleteMany({ where: c });
        continue;
      }
      await tx.eventDriver.upsert({
        where: { outlookCalendarId_graphId: c },
        create: { ...c, personId: driverId, setById: profile.id, endsAt: target.endsAt },
        update: { personId: driverId, setById: profile.id, endsAt: target.endsAt },
      });
    }
  });
  return { ok: true };
}
