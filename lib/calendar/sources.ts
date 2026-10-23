import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { getVehiclesWithStatus } from "@/lib/vehicles/queries";
import { wallClockToInstant } from "@/lib/school/feeds/parse";

/**
 * The rows the family calendar is made of, read from each app. Shared by the in-app agenda
 * (/calendar, lib/calendar/queries.ts) and the Outlook write-back (lib/calendar-sync), so
 * both show the same birthdays, car dates and chores. Only reads: nothing here generates
 * task instances or decides who may see what beyond the parameters it's given.
 */

export type ImportantDateRow = {
  id: string;
  type: "BIRTHDAY" | "ANNIVERSARY" | "OTHER";
  label: string | null;
  month: number;
  day: number;
  year: number | null;
  personId: string;
  personName: string;
};

export async function loadImportantDates(householdId: string): Promise<ImportantDateRow[]> {
  const dates = await prisma.importantDate.findMany({
    where: { person: { householdId } },
    select: {
      id: true,
      type: true,
      label: true,
      month: true,
      day: true,
      year: true,
      person: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return dates.map((d) => ({
    id: d.id,
    type: d.type,
    label: d.label,
    month: d.month,
    day: d.day,
    year: d.year,
    personId: d.person.id,
    personName: [d.person.firstName, d.person.lastName].filter(Boolean).join(" "),
  }));
}

export type VehicleDueRow = { itemId: string; title: string; vehicleId: string; vehicleName: string; dueByDate: Date };

/** Maintenance due by a date. Mileage-only items have no day to put on a calendar, so they're left out. */
export async function loadVehicleDueDates(householdId: string): Promise<VehicleDueRow[]> {
  const boards = await getVehiclesWithStatus(householdId);
  return boards.flatMap(({ vehicle, items }) =>
    items.flatMap(({ item, due }) =>
      due.dueByDate
        ? [{ itemId: item.id, title: item.title, vehicleId: vehicle.id, vehicleName: vehicle.name, dueByDate: due.dueByDate }]
        : [],
    ),
  );
}

export type TaskDomainRow = "CHORE" | "MED";

export type TaskRow = {
  id: string;
  domain: TaskDomainRow;
  title: string;
  /** Server-local midnight, plus the dose's "HH:mm" when timed. */
  dueDate: Date;
  timed: boolean;
  status: "PENDING" | "DONE" | "SKIPPED";
  assigneeName: string | null;
};

/**
 * Chore and med instances due in [from, until). The write-back wants only what's still to
 * do from active chores (`pendingOnly`, `activeOnly`); the agenda shows what the boards
 * show, done ones included.
 */
export async function loadTaskInstances(
  householdId: string,
  opts: { domains: readonly TaskDomainRow[]; from: Date; until: Date; pendingOnly?: boolean; activeOnly?: boolean },
): Promise<TaskRow[]> {
  if (opts.domains.length === 0 || !(opts.until > opts.from)) return [];
  const tasks = await prisma.taskInstance.findMany({
    where: {
      ...(opts.pendingOnly ? { status: "PENDING" as const } : {}),
      dueDate: { gte: opts.from, lt: opts.until },
      definition: { householdId, ...(opts.activeOnly ? { active: true } : {}), domain: { in: [...opts.domains] } },
    },
    select: {
      id: true,
      dueDate: true,
      status: true,
      assignedTo: { select: { firstName: true } },
      definition: { select: { title: true, domain: true, timesOfDay: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  return tasks.map((t) => ({
    id: t.id,
    domain: t.definition.domain as TaskDomainRow,
    title: t.definition.title,
    dueDate: t.dueDate,
    timed: t.definition.timesOfDay.length > 0,
    status: t.status,
    assigneeName: t.assignedTo?.firstName ?? null,
  }));
}

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

export type SchoolDueRow = {
  id: string;
  kind: "task" | "assignment";
  title: string;
  dueDate: Date;
  who: string | null;
  /** The student it belongs to, for the link to their School tab. Null: the whole family's. */
  studentId: string | null;
  done: boolean;
  /** Marked missing by the teacher. */
  missing: boolean;
};

/**
 * School to-dos and homework due in [from, until), scoped like Home's School card
 * (getSchoolDueSoon in lib/school/queries.ts): a grown-up sees every student's; a kid sees
 * only their own homework and no to-dos, which are forms and fees for grown-ups to handle.
 * Amounts are never read.
 */
export async function loadSchoolDue(viewer: Viewer, from: Date, until: Date): Promise<SchoolDueRow[]> {
  const adult = isAdult(viewer);
  const [tasks, assignments] = await Promise.all([
    adult
      ? prisma.schoolTask.findMany({
          where: { householdId: viewer.householdId, dueDate: { gte: from, lt: until } },
          select: { id: true, title: true, dueDate: true, status: true, kidPersonId: true, kid: { select: { firstName: true } } },
        })
      : [],
    prisma.schoolAssignment.findMany({
      where: {
        dueDate: { gte: from, lt: until },
        profile: { person: { householdId: viewer.householdId, ...(adult ? {} : { id: viewer.id }) } },
      },
      select: {
        id: true,
        title: true,
        className: true,
        dueDate: true,
        status: true,
        profile: { select: { personId: true, person: { select: { firstName: true } } } },
      },
    }),
  ]);
  return [
    ...tasks.map((t) => ({
      id: t.id,
      kind: "task" as const,
      title: t.title,
      dueDate: t.dueDate!,
      who: t.kid?.firstName ?? null,
      studentId: t.kidPersonId,
      done: t.status === "DONE",
      missing: false,
    })),
    ...assignments.map((a) => ({
      id: a.id,
      kind: "assignment" as const,
      title: `${a.className}: ${a.title}`,
      dueDate: a.dueDate!,
      who: a.profile.person.firstName,
      studentId: a.profile.personId,
      done: a.status === "DONE",
      missing: a.status === "MISSING",
    })),
  ];
}

export type SchoolEventRow = {
  key: string;
  title: string;
  location: string | null;
  /** All-day: UTC midnight of the first day, `endsAt` exclusive. Timed: instants. */
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  who: string | null;
  studentId: string | null;
};

const ymdParts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()] as const;

/**
 * School calendar feed events (Phase 18.5) overlapping the local days [firstDay, untilDay),
 * scoped like getUpcomingSchoolEvents in lib/school/queries.ts: a kid gets their own feeds
 * plus the family's, a grown-up every feed. All-day rows are UTC midnights of their dates
 * and timed rows are instants, so each gets its own cutoffs, the timed ones in the
 * household's zone.
 */
export async function loadSchoolEvents(viewer: Viewer, firstDay: Date, untilDay: Date, timeZone: string): Promise<SchoolEventRow[]> {
  const studentId = isAdult(viewer) ? undefined : viewer.id;
  const [fy, fm, fd] = ymdParts(firstDay);
  const [uy, um, ud] = ymdParts(untilDay);
  const events = await prisma.schoolFeedEvent.findMany({
    where: {
      feed: {
        householdId: viewer.householdId,
        active: true,
        ...(studentId ? { OR: [{ kidPersonId: null }, { kidPersonId: studentId }] } : {}),
      },
      OR: [
        { allDay: true, endsAt: { gt: new Date(Date.UTC(fy, fm - 1, fd)) }, startsAt: { lt: new Date(Date.UTC(uy, um - 1, ud)) } },
        {
          allDay: false,
          endsAt: { gt: wallClockToInstant(fy, fm, fd, 0, 0, 0, timeZone) },
          startsAt: { lt: wallClockToInstant(uy, um, ud, 0, 0, 0, timeZone) },
        },
      ],
    },
    select: {
      occurrenceKey: true,
      feedId: true,
      title: true,
      location: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      feed: { select: { kidPersonId: true, kid: { select: { firstName: true } } } },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  return events.map((e) => ({
    key: `${e.feedId}:${e.occurrenceKey}`,
    title: e.title,
    location: e.location,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    who: e.feed.kid?.firstName ?? null,
    studentId: e.feed.kidPersonId,
  }));
}
