import { prisma } from "@/lib/prisma";
import type { TaskDomain } from "@/app/generated/prisma/enums";
import { addDays, atMidnight } from "./schedule";

/**
 * How far back "Overdue" reaches. A missed dose from three weeks ago isn't something to do
 * now; older misses show as one count a grown-up can clear (markOlderMissed), instead of a
 * list that grows every day nobody opens the app.
 */
export const OVERDUE_WINDOW_DAYS = 7;

/** The start of the oldest day still shown as overdue. */
export function overdueSince(now: Date = new Date()): Date {
  return addDays(atMidnight(now), -OVERDUE_WINDOW_DAYS);
}

/**
 * A grown-up's "Skip" (or "Missed", for one already past): nobody did it, so no stickers and,
 * for a med, no stock used. Only a still-pending one, in this household and domain. Who and
 * when are kept on the row, like a completion, so it can be undone and shows who skipped it.
 */
export async function skipInstance(opts: { householdId: string; domain: TaskDomain; instanceId: string; byId: string }) {
  const { count } = await prisma.taskInstance.updateMany({
    where: { id: opts.instanceId, status: "PENDING", definition: { householdId: opts.householdId, domain: opts.domain } },
    data: { status: "SKIPPED", completedAt: new Date(), completedById: opts.byId },
  });
  return count > 0;
}

/** Puts a skipped one back to waiting. */
export async function unskipInstance(opts: { householdId: string; domain: TaskDomain; instanceId: string }) {
  const { count } = await prisma.taskInstance.updateMany({
    where: { id: opts.instanceId, status: "SKIPPED", definition: { householdId: opts.householdId, domain: opts.domain } },
    data: { status: "PENDING", completedAt: null, completedById: null },
  });
  return count > 0;
}

/**
 * Everything still waiting from before the overdue window, marked missed in one go: the whole
 * household's, or one person's when the board is filtered to them (the count it showed).
 */
export async function markOlderMissed(opts: { householdId: string; domain: TaskDomain; byId: string; personId?: string | null; now?: Date }) {
  const { count } = await prisma.taskInstance.updateMany({
    where: {
      status: "PENDING",
      dueDate: { lt: overdueSince(opts.now) },
      definition: { householdId: opts.householdId, domain: opts.domain },
      ...(opts.personId ? { assignedToId: opts.personId } : {}),
    },
    data: { status: "SKIPPED", completedAt: new Date(), completedById: opts.byId },
  });
  return count;
}
