import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { byDueDate, isOverdue } from "./rules";
import { wallClockToInstant } from "./feeds/parse";

/**
 * School reads (Phase 18). Visibility: adults see every student; a kid sees only
 * themselves, since grades are personal (Fable's scope review default). Every query is
 * scoped to the household.
 */

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

export function canSeeStudent(viewer: Viewer, personId: string): boolean {
  return isAdult(viewer) || viewer.id === personId;
}

/**
 * Household members who are (or could be) students: kids, plus anyone who already has a
 * school profile (an adult taking a class). A kid viewer gets only themselves.
 */
export async function listStudents(viewer: Viewer) {
  const people = await prisma.person.findMany({
    where: {
      householdId: viewer.householdId,
      isHouseholdMember: true,
      OR: [{ role: "KID" }, { schoolProfile: { isNot: null } }],
      ...(isAdult(viewer) ? {} : { id: viewer.id }),
    },
    select: { id: true, firstName: true, lastName: true, schoolProfile: { select: { id: true, schoolName: true, grade: true } } },
    orderBy: { firstName: "asc" },
  });
  return people;
}

export async function getStudentHub(viewer: Viewer, personId: string) {
  if (!canSeeStudent(viewer, personId)) return null;
  const person = await prisma.person.findFirst({
    where: { id: personId, householdId: viewer.householdId, isHouseholdMember: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      schoolProfile: {
        include: {
          contacts: {
            include: { person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
            orderBy: { role: "asc" },
          },
          assignments: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!person) return null;

  // A task for someone who's since left the household shows as everyone's, so it can't
  // hide (Fable's implementation review).
  const forThisStudent = [{ kidPersonId: personId }, { kidPersonId: null }, { kid: { isHouseholdMember: false } }];
  const [tasks, recentlyDone] = await Promise.all([
    prisma.schoolTask.findMany({
      where: { householdId: viewer.householdId, status: "OPEN", OR: forThisStudent },
      include: { owner: { select: { firstName: true } }, kid: { select: { firstName: true } } },
    }),
    // Ticked off in the last two weeks, so a mis-tap can be undone.
    prisma.schoolTask.findMany({
      where: { householdId: viewer.householdId, status: "DONE", doneAt: { gte: addDays(new Date(), -14) }, OR: forThisStudent },
      select: { id: true, title: true, doneAt: true },
      orderBy: { doneAt: "desc" },
      take: 10,
    }),
  ]);
  return { person, tasks: tasks.sort(byDueDate), recentlyDone };
}

export type SchoolDueItem = { id: string; kind: "task" | "assignment"; title: string; who: string | null; dueDate: Date | null; overdue: boolean; href: string };

/** Home's School card: open to-dos and assignments due within `days`, or overdue. */
export async function getSchoolDueSoon(viewer: Viewer, days = 7): Promise<SchoolDueItem[]> {
  const today = atMidnight(new Date());
  const horizon = addDays(today, days + 1);
  // Overdue only as far back as two weeks: older leftovers would otherwise fill the card
  // and push out what's actually due this week. They stay on /school.
  const oldest = addDays(today, -14);
  const adult = isAdult(viewer);
  const [tasks, assignments] = await Promise.all([
    adult
      ? prisma.schoolTask.findMany({
          where: { householdId: viewer.householdId, status: "OPEN", dueDate: { gte: oldest, lt: horizon } },
          include: { kid: { select: { firstName: true } } },
        })
      : [],
    prisma.schoolAssignment.findMany({
      where: {
        status: "TODO",
        dueDate: { gte: oldest, lt: horizon },
        profile: { person: { householdId: viewer.householdId, ...(adult ? {} : { id: viewer.id }) } },
      },
      include: { profile: { select: { personId: true, person: { select: { firstName: true } } } } },
    }),
  ]);
  const items: SchoolDueItem[] = [
    ...tasks.map((t) => ({
      id: t.id,
      kind: "task" as const,
      title: t.title,
      who: t.kid?.firstName ?? null,
      dueDate: t.dueDate,
      overdue: t.dueDate != null && t.dueDate < today,
      href: t.kidPersonId ? `/school?kid=${t.kidPersonId}` : "/school",
    })),
    ...assignments.map((a) => ({
      id: a.id,
      kind: "assignment" as const,
      title: `${a.className}: ${a.title}`,
      who: a.profile.person.firstName,
      dueDate: a.dueDate,
      overdue: isOverdue(a, today),
      href: `/school?kid=${a.profile.personId}`,
    })),
  ];
  return items.sort(byDueDate);
}

/** For calendar write-back (lib/calendar-sync): open to-dos and TODO assignments with a date, from `from` on. */
export async function getSchoolCalendarItems(householdId: string, from: Date) {
  const [tasks, assignments] = await Promise.all([
    prisma.schoolTask.findMany({
      where: { householdId, status: "OPEN", dueDate: { gte: from } },
      select: { id: true, title: true, dueDate: true, kid: { select: { firstName: true } } },
    }),
    prisma.schoolAssignment.findMany({
      where: { status: "TODO", dueDate: { gte: from }, profile: { person: { householdId } } },
      select: { id: true, title: true, className: true, dueDate: true, profile: { select: { person: { select: { firstName: true } } } } },
    }),
  ]);
  return {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate!, who: t.kid?.firstName ?? null })),
    assignments: assignments.map((a) => ({ id: a.id, title: `${a.className}: ${a.title}`, dueDate: a.dueDate!, who: a.profile.person.firstName })),
  };
}

/**
 * Upcoming school-calendar events (Phase 18.5) from active feeds: a student's own feeds
 * plus the family's. A kid only ever gets their own plus the family's; an adult asking
 * with no student gets every feed (Home).
 */
export async function getUpcomingSchoolEvents(viewer: Viewer, opts: { days: number; studentId?: string; timeZone: string }) {
  const studentId = isAdult(viewer) ? opts.studentId : viewer.id;
  // "Today" where the family lives: all-day rows are UTC midnight of their date, timed
  // rows are instants, so each gets its own cutoff (Fable's implementation review).
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: opts.timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const dayMs = 86_400_000;
  const allDayFrom = new Date(Date.UTC(y, m - 1, d));
  const allDayUntil = new Date(allDayFrom.getTime() + (opts.days + 1) * dayMs);
  const timedFrom = wallClockToInstant(y, m, d, 0, 0, 0, opts.timeZone);
  const timedUntil = new Date(timedFrom.getTime() + (opts.days + 1) * dayMs);
  return prisma.schoolFeedEvent.findMany({
    where: {
      feed: {
        householdId: viewer.householdId,
        active: true,
        ...(studentId ? { OR: [{ kidPersonId: null }, { kidPersonId: studentId }] } : {}),
      },
      OR: [
        { allDay: true, endsAt: { gt: allDayFrom }, startsAt: { lt: allDayUntil } },
        { allDay: false, endsAt: { gt: timedFrom }, startsAt: { lt: timedUntil } },
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
      feed: { select: { name: true, kid: { select: { firstName: true } } } },
    },
    orderBy: { startsAt: "asc" },
    take: 60,
  });
}
