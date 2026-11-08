import { prisma } from "@/lib/prisma";

/**
 * Phase 70c: chores a kid ticked that wait for a grown-up's check (TaskDefinition.needsCheck),
 * oldest first, for the Chores board and a count on Home.
 */
export async function waitingForCheck(householdId: string) {
  return prisma.taskInstance.findMany({
    where: { status: "DONE", awaitingCheck: true, definition: { householdId, domain: "CHORE" } },
    select: { id: true, dueDate: true, definition: { select: { title: true, points: true } }, completedBy: { select: { firstName: true } }, assignedTo: { select: { firstName: true } } },
    orderBy: { dueDate: "asc" },
    take: 50,
  });
}

export async function waitingForCheckCount(householdId: string): Promise<number> {
  return prisma.taskInstance.count({ where: { status: "DONE", awaitingCheck: true, definition: { householdId, domain: "CHORE" } } });
}
