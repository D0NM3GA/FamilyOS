import { prisma } from "@/lib/prisma";
import type { TaskDomain } from "@/app/generated/prisma/enums";
import { atMidnight, addDays } from "./schedule";
import { overdueSince } from "./skip";

type BucketableInstance = { status: "PENDING" | "DONE" | "SKIPPED"; dueDate: Date };

/**
 * Pure bucketing — no Prisma. Splits by day-range rather than a midnight-equality check
 * against `today`, so a timed (meds) dueDate like 08:00 correctly lands in `dueToday`
 * instead of always falling into `upcoming` (or being excluded outright by a midnight-only
 * horizon) the way a strict `dueDate.getTime() === today.getTime()` check would. For
 * midnight-only dueDates (all of Chores, today) this produces the identical split as the
 * equality check did — see lib/tasks/queries.test.ts.
 *
 * `horizonExclusive` is the start of the day AFTER the last day to include (i.e. the
 * caller's horizon day + 1, at midnight) — every comparison here is a plain range check,
 * no off-by-one juggling at the call site.
 */
export function bucketInstances<T extends BucketableInstance>(
  instances: T[],
  today: Date,
  horizonExclusive: Date,
): { overdue: T[]; dueToday: T[]; upcoming: T[] } {
  const tomorrow = addDays(today, 1);
  return {
    overdue: instances.filter((i) => i.status === "PENDING" && i.dueDate < today),
    dueToday: instances.filter((i) => i.dueDate >= today && i.dueDate < tomorrow),
    upcoming: instances.filter(
      (i) => i.status === "PENDING" && i.dueDate >= tomorrow && i.dueDate < horizonExclusive,
    ),
  };
}

export async function getBoardInstances(
  householdId: string,
  /** `includeUnassigned` with `personId`: their own plus "Anyone" ones (a kid's "my chores"). */
  opts: { horizonDays?: number; personId?: string; includeUnassigned?: boolean; domain: TaskDomain },
) {
  const { horizonDays = 14, personId, includeUnassigned = false, domain } = opts;
  const today = atMidnight(new Date());
  const horizon = addDays(today, horizonDays); // last calendar day included, at midnight
  const horizonExclusive = addDays(horizon, 1); // start of the day after — DB filter uses this

  const since = overdueSince(today);
  // The person filter goes under AND: the window below is an OR of its own, and two OR keys
  // in one where would overwrite each other (the person filter silently dropped).
  const scope = {
    definition: { householdId, domain },
    ...(personId ? { AND: [includeUnassigned ? { OR: [{ assignedToId: personId }, { assignedToId: null }] } : { assignedToId: personId }] } : {}),
  };
  const [instances, olderMissed] = await Promise.all([
    prisma.taskInstance.findMany({
      where: {
        ...scope,
        // Only what bucketInstances keeps: pending ones from the overdue window (lib/tasks/
        // skip.ts), and everything from today to the horizon. Done/skipped history grows
        // with every chore and dose.
        OR: [{ status: "PENDING", dueDate: { gte: since, lt: today } }, { dueDate: { gte: today, lt: horizonExclusive } }],
      },
      include: {
        definition: true,
        assignedTo: { omit: { photo: true } },
        completedBy: { omit: { photo: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
    // Still waiting from before the window: one count, cleared with "Mark them missed".
    prisma.taskInstance.count({ where: { ...scope, status: "PENDING", dueDate: { lt: since } } }),
  ]);

  const { overdue, dueToday, upcoming } = bucketInstances(instances, today, horizonExclusive);

  return { overdue, dueToday, upcoming, olderMissed, today, horizon };
}

export async function getPointsTally(householdId: string, opts: { domain: TaskDomain }) {
  const members = await prisma.person.findMany({
    where: { householdId, isHouseholdMember: true },
    omit: { photo: true },
    orderBy: { firstName: "asc" },
  });

  // Domain-filtered via the instance's definition — a manual point adjustment with no
  // instanceId (schema allows it, nothing creates one yet) wouldn't belong to any single
  // domain's tally and is excluded here rather than double-counted across all of them.
  const sums = await prisma.pointsLedger.groupBy({
    by: ["personId"],
    where: { person: { householdId }, instance: { definition: { domain: opts.domain } } },
    _sum: { delta: true },
  });
  const sumByPerson = new Map(sums.map((s) => [s.personId, s._sum.delta ?? 0]));

  return members
    .map((m) => ({ person: m, points: sumByPerson.get(m.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);
}

/** Phase 19.5: one person's sticker balance (Big buttons Home), without loading everyone. */
export async function getPointsBalance(personId: string): Promise<number> {
  const { _sum } = await prisma.pointsLedger.aggregate({ where: { personId }, _sum: { delta: true } });
  return _sum.delta ?? 0;
}

/**
 * Household-wide point balance per member — the number app/(app)/points spends against,
 * deliberately NOT domain-filtered the way getPointsTally above is. Chores and Meds both
 * award into the same PointsLedger (Meds credits the person a dose was for), and a
 * redemption (a negative delta row with `instanceId: null` — see app/(app)/points/actions.ts)
 * isn't tied to either domain either, so it has to be summed in, not excluded the way
 * getPointsTally's own domain join would exclude it. The Chores/Meds board pills keep
 * meaning "earned in this domain" — this function is for the shared balance/shop, not a
 * replacement for those.
 */
export async function getPointsBalances(householdId: string) {
  const members = await prisma.person.findMany({
    where: { householdId, isHouseholdMember: true },
    omit: { photo: true },
    orderBy: { firstName: "asc" },
  });

  const sums = await prisma.pointsLedger.groupBy({
    by: ["personId"],
    where: { person: { householdId } },
    _sum: { delta: true },
  });
  const sumByPerson = new Map(sums.map((s) => [s.personId, s._sum.delta ?? 0]));

  return members
    .map((m) => ({ person: m, points: sumByPerson.get(m.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);
}
