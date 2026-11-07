import { prisma } from "@/lib/prisma";
import { withStoredDays } from "@/lib/household-zone";
import { recordEvent, eventDate } from "@/lib/work-items/events";
import { addDays, atMidnight } from "./schedule";

/**
 * Phase 59.2b: a grown-up moves one chore to tomorrow, or an overdue one to today (the owner's
 * call, 2026-11-07). Not a daily chore: tomorrow's copy already exists, and
 * @@unique([definitionId, dueDate]) allows one a day, so Skip covers those. The day it came from is
 * kept in movedFrom, which instance generation treats as taken.
 */

export type MoveTarget = "today" | "tomorrow";
export type MoveChoices = { tomorrow: boolean; today: boolean; back: boolean };

type Movable = { id: string; definitionId: string; dueDate: Date; status: string; movedFrom: Date | null; frequencyType: string };

/** Where a chore may go from here, given the days its chore already has an instance on. Pure. */
export function moveChoices(i: Movable, takenDays: Set<string>, now: Date = new Date()): MoveChoices {
  const today = atMidnight(now);
  const tomorrow = addDays(today, 1);
  const free = (d: Date) => !takenDays.has(`${i.definitionId}|${d.getTime()}`);
  const pending = i.status === "PENDING";
  const movable = pending && i.frequencyType !== "DAILY";
  return {
    tomorrow: movable && i.dueDate < tomorrow && free(tomorrow),
    today: movable && i.dueDate < today && free(today),
    back: pending && i.movedFrom != null && i.movedFrom.getTime() !== i.dueDate.getTime() && free(i.movedFrom),
  };
}

/** The days today and tomorrow that each of these chores already has, as "definitionId|time". */
export async function takenDays(definitionIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (definitionIds.length === 0) return new Set();
  const today = atMidnight(now);
  const rows = await prisma.taskInstance.findMany({
    where: { definitionId: { in: definitionIds }, dueDate: { in: [today, addDays(today, 1)] } },
    select: { definitionId: true, dueDate: true },
  });
  return new Set(rows.map((r) => `${r.definitionId}|${r.dueDate.getTime()}`));
}

/**
 * Moves one chore, under the stored-days lock (a zone move mustn't land in between). Checks
 * everything again: still pending, still in this household, not daily, the day still free. A
 * clash or a change in between does nothing.
 */
export async function moveChore(opts: { householdId: string; instanceId: string; to: MoveTarget | "back"; byId: string; now?: Date }): Promise<boolean> {
  try {
    return await moveUnderLock(opts);
  } catch (err) {
    // Another move took the day in the same moment: one a day, so this one does nothing.
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

function moveUnderLock(opts: { householdId: string; instanceId: string; to: MoveTarget | "back"; byId: string; now?: Date }): Promise<boolean> {
  return withStoredDays(async (tx) => {
    const i = await tx.taskInstance.findFirst({
      where: { id: opts.instanceId, status: "PENDING", definition: { householdId: opts.householdId, domain: "CHORE" } },
      include: { definition: { select: { frequencyType: true } } },
    });
    if (!i) return false;
    const target = opts.to === "back" ? i.movedFrom : opts.to === "today" ? atMidnight(opts.now ?? new Date()) : addDays(atMidnight(opts.now ?? new Date()), 1);
    if (!target) return false;
    const clash = await tx.taskInstance.findFirst({ where: { definitionId: i.definitionId, dueDate: target, NOT: { id: i.id } }, select: { id: true } });
    const taken = new Set(clash ? [`${i.definitionId}|${target.getTime()}`] : []);
    const choices = moveChoices({ ...i, frequencyType: i.definition.frequencyType }, taken, opts.now);
    if (!choices[opts.to]) return false;
    const { count } = await tx.taskInstance.updateMany({
      where: { id: i.id, status: "PENDING", dueDate: i.dueDate },
      // Back home clears the mark; a second move keeps the first day.
      data: { dueDate: target, movedFrom: opts.to === "back" ? null : (i.movedFrom ?? i.dueDate) },
    });
    if (count === 0) return false;
    await recordEvent(tx, { householdId: opts.householdId, itemType: "CHORE", itemId: i.id, actorId: opts.byId, action: "MOVE", fromValue: eventDate(i.dueDate), toValue: eventDate(target) });
    return true;
  });
}
