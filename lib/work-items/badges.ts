import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/roles";
import { isOverdue } from "@/lib/school/rules";
import { overdueSince } from "@/lib/tasks/skip";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 59.4b: the People list's badges for household members: "2 overdue", "1 missing", "Test
 * Thu". Overdue counts each board's own rule (chores within the overdue window, homework unbounded),
 * so a badge matches what its board shows. Only for apps that are on; a kid sees only their own
 * (grades are personal).
 */

export type BadgeCounts = { overdue: number; missing: number; nextTest: Date | null };

/** The words, in order of urgency. Pure. */
export function badgeWords(c: BadgeCounts, timeZone?: string): string[] {
  const out: string[] = [];
  if (c.overdue > 0) out.push(`${c.overdue} overdue`);
  if (c.missing > 0) out.push(`${c.missing} missing`);
  if (c.nextTest) out.push(`Test ${c.nextTest.toLocaleDateString("en-US", { weekday: "short", timeZone })}`);
  return out;
}

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

export async function peopleBadges(viewer: Viewer, apps: { chores: boolean; school: boolean }, now: Date = new Date()): Promise<Map<string, BadgeCounts>> {
  const today = atMidnight(now);
  const onlyMe = isAdult(viewer) ? {} : { id: viewer.id };
  const counts = new Map<string, BadgeCounts>();
  const bump = (personId: string | null, f: (c: BadgeCounts) => void) => {
    if (!personId) return;
    const c = counts.get(personId) ?? { overdue: 0, missing: 0, nextTest: null };
    f(c);
    counts.set(personId, c);
  };
  const [chores, work] = await Promise.all([
    apps.chores
      ? prisma.taskInstance.groupBy({
          by: ["assignedToId"],
          where: {
            status: "PENDING",
            dueDate: { gte: overdueSince(today), lt: today },
            definition: { householdId: viewer.householdId, domain: "CHORE" },
            assignedTo: { isHouseholdMember: true, ...onlyMe },
          },
          _count: { _all: true },
        })
      : [],
    apps.school
      ? prisma.schoolAssignment.findMany({
          where: { status: { in: ["TODO", "MISSING"] }, profile: { person: { householdId: viewer.householdId, isHouseholdMember: true, ...onlyMe } } },
          select: { status: true, dueDate: true, kind: true, profile: { select: { personId: true } } },
        })
      : [],
  ]);
  for (const g of chores) bump(g.assignedToId, (c) => (c.overdue += g._count._all));
  const weekEnd = addDays(today, 7);
  for (const a of work) {
    const who = a.profile.personId;
    if (a.status === "MISSING") bump(who, (c) => c.missing++);
    else if (isOverdue(a, now)) bump(who, (c) => c.overdue++);
    else if ((a.kind === "TEST" || a.kind === "QUIZ") && a.dueDate && a.dueDate >= today && a.dueDate < weekEnd) {
      bump(who, (c) => {
        if (!c.nextTest || a.dueDate! < c.nextTest) c.nextTest = a.dueDate;
      });
    }
  }
  return counts;
}
