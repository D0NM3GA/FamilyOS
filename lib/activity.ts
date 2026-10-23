import { prisma } from "@/lib/prisma";
import { fullName } from "@/lib/people";
import { isLinkOn } from "@/lib/apps";

export type ActivityEntry = { id: string; timestamp: Date; text: string; href: string };

const INTERACTION_PHRASE: Record<string, string> = {
  CALL: "a call",
  TEXT: "a text",
  EMAIL: "an email",
  VISIT: "a visit",
  NOTE: "a note",
};

async function choreAndMedCompletions(householdId: string, take: number): Promise<ActivityEntry[]> {
  const instances = await prisma.taskInstance.findMany({
    where: { definition: { householdId }, status: "DONE", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take,
    select: {
      id: true,
      completedAt: true,
      definition: { select: { title: true, domain: true } },
      completedBy: { select: { firstName: true } },
    },
  });

  return instances.map((i) => ({
    id: `task-${i.id}`,
    // Filtered by completedAt: { not: null } above, so this is never actually null.
    timestamp: i.completedAt as Date,
    text: `${i.completedBy?.firstName ?? "Someone"} completed "${i.definition.title}"`,
    href: i.definition.domain === "MED" ? "/meds" : "/chores",
  }));
}

async function interactions(householdId: string, take: number, viewerIsAdult: boolean): Promise<ActivityEntry[]> {
  const logs = await prisma.interactionLog.findMany({
    // Grown-ups-only ones stay out of a kid's feed: even "logged a call with X" says something.
    where: { person: { householdId }, ...(viewerIsAdult ? {} : { adultsOnly: false }) },
    orderBy: { occurredAt: "desc" },
    take,
    select: {
      id: true,
      occurredAt: true,
      type: true,
      personId: true,
      person: { select: { firstName: true, lastName: true } },
      loggedBy: { select: { firstName: true } },
    },
  });

  return logs.map((log) => {
    const phrase = INTERACTION_PHRASE[log.type] ?? "an interaction";
    return {
      id: `interaction-${log.id}`,
      timestamp: log.occurredAt,
      text: `${log.loggedBy ? `${log.loggedBy.firstName} logged` : "Someone logged"} ${phrase} with ${fullName(log.person)}`,
      href: `/people/${log.personId}`,
    };
  });
}

async function vehicleServiceEntries(householdId: string, take: number): Promise<ActivityEntry[]> {
  const logs = await prisma.vehicleServiceLog.findMany({
    where: { item: { vehicle: { householdId } } },
    // createdAt (when it was logged), not doneAt (which is routinely backdated from an
    // invoice) — a feed sorted by doneAt would bury today's entry a month back.
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      item: { select: { title: true, vehicle: { select: { id: true, name: true } } } },
      loggedBy: { select: { firstName: true } },
    },
  });

  return logs.map((log) => ({
    id: `service-${log.id}`,
    timestamp: log.createdAt,
    text: `${log.loggedBy?.firstName ?? "Someone"} logged "${log.item.title}" on ${log.item.vehicle.name}`,
    // The vehicle detail page, not the edit form: it carries the full service history. A kid's
    // feed drops it with the rest of Cars (appsOffFor in lib/apps.ts).
    href: `/vehicles/${log.item.vehicle.id}`,
  }));
}

async function vehicleFuelEntries(householdId: string, take: number): Promise<ActivityEntry[]> {
  const logs = await prisma.vehicleFuelLog.findMany({
    where: { vehicle: { householdId } },
    // createdAt, not filledAt — same reasoning as vehicleServiceEntries above.
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      vehicle: { select: { id: true, name: true } },
      loggedBy: { select: { firstName: true } },
    },
  });

  return logs.map((log) => ({
    id: `fuel-${log.id}`,
    timestamp: log.createdAt,
    text: `${log.loggedBy?.firstName ?? "Someone"} logged a fill-up for ${log.vehicle.name}`,
    href: `/vehicles/${log.vehicle.id}`,
  }));
}

async function purchases(householdId: string, take: number): Promise<ActivityEntry[]> {
  const trips = await prisma.purchase.findMany({
    where: { householdId },
    orderBy: { purchasedAt: "desc" },
    take,
    select: {
      id: true,
      purchasedAt: true,
      purchasedBy: { select: { firstName: true } },
      _count: { select: { items: true } },
    },
  });

  return trips.map((trip) => ({
    id: `purchase-${trip.id}`,
    timestamp: trip.purchasedAt,
    text: `${trip.purchasedBy?.firstName ?? "Someone"} completed a shopping trip — ${trip._count.items} item${trip._count.items === 1 ? "" : "s"}`,
    href: "/groceries",
  }));
}

/** School (Phase 18): finished homework and forms. Never a grade: activity is household-wide. */
async function schoolCompletions(householdId: string, take: number): Promise<ActivityEntry[]> {
  const [assignments, tasks] = await Promise.all([
    prisma.schoolAssignment.findMany({
      where: { status: "DONE", doneAt: { not: null }, profile: { person: { householdId } } },
      orderBy: { doneAt: "desc" },
      take,
      select: { id: true, doneAt: true, className: true, profile: { select: { personId: true, person: { select: { firstName: true } } } } },
    }),
    prisma.schoolTask.findMany({
      where: { householdId, status: "DONE", doneAt: { not: null } },
      orderBy: { doneAt: "desc" },
      take,
      select: { id: true, doneAt: true, title: true },
    }),
  ]);
  return [
    ...assignments.map((a) => ({
      id: `assignment-${a.id}`,
      timestamp: a.doneAt!,
      text: `${a.profile.person.firstName} finished some ${a.className} homework`,
      href: `/school?kid=${a.profile.personId}`,
    })),
    ...tasks.map((t) => ({ id: `schooltask-${t.id}`, timestamp: t.doneAt!, text: `School to-do done: ${t.title}`, href: "/school" })),
  ];
}

/**
 * Read-time union of recent events across every domain, newest first — see lib/search.ts's
 * doc comment for why this (like search) is a deliberately unregistered cross-domain kernel
 * aggregator in eslint.config.mjs, not a domain of its own. Each source above is a plain,
 * independent query; a later phase adds its own source function and one entry to the
 * `sources` array below, not a change to the merge/sort logic. Each source reads at most
 * `limit` rows, since the merged feed can't use more than that from any one of them.
 *
 * Phase 36: entries that link into one of `disabledApps` (the family's turned-off apps) drop
 * out, by where they link, so a new source needs nothing extra to follow the switches.
 */
export async function getHouseholdActivity(
  householdId: string,
  limit = 20,
  opts: { viewerIsAdult: boolean; disabledApps?: readonly string[] } = { viewerIsAdult: false },
): Promise<ActivityEntry[]> {
  const disabled = opts.disabledApps ?? [];
  const sources = await Promise.all([
    choreAndMedCompletions(householdId, limit),
    interactions(householdId, limit, opts.viewerIsAdult),
    vehicleServiceEntries(householdId, limit),
    vehicleFuelEntries(householdId, limit),
    purchases(householdId, limit),
    schoolCompletions(householdId, limit),
  ]);

  return sources
    .flat()
    .filter((e) => isLinkOn(disabled, e.href))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}
