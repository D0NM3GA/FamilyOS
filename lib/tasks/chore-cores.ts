import type { Prisma } from "@/app/generated/prisma/client";
import { recordEvent } from "@/lib/work-items/events";
import { milestoneCrossed } from "./milestones";
import { canDoChore, canDoChoreYet, canSkipChore, canUndoChore } from "./permissions";
import { skipInstance as skipTask, unskipInstance as unskipTask } from "./skip";

/**
 * Phase 59.3: what each chore action does to one chore, inside a transaction it's handed, so a
 * single tap and a bulk action run exactly the same rules. Never throws for an ordinary refusal:
 * it says why, and the caller decides (a single action may throw "not found"; a bulk one counts).
 */

type Tx = Prisma.TransactionClient;
export type ChoreViewer = { id: string; householdId: string; adult: boolean };
export type CoreResult = { ok: true } | { ok: false; reason: "not found" | "not allowed" | "already done" | "changed" | "not yet" };

const find = (tx: Tx, viewer: ChoreViewer, instanceId: string) =>
  tx.taskInstance.findFirst({
    where: { id: instanceId, definition: { householdId: viewer.householdId, domain: "CHORE" } },
    include: { definition: true, assignedTo: { select: { firstName: true } } },
  });

/**
 * Done: stickers to whoever it's assigned to (or whoever grabbed an "Anyone" one), and the
 * milestone crossed, if any. Pinned to the assignee read, so a give-to racing it does nothing.
 */
export async function completeChore(tx: Tx, viewer: ChoreViewer, instanceId: string): Promise<CoreResult & { milestone?: number | null; waiting?: boolean }> {
  const instance = await find(tx, viewer, instanceId);
  if (!instance) return { ok: false, reason: "not found" };
  if (instance.status !== "PENDING") return { ok: false, reason: "already done" };
  if (!canDoChore(viewer, instance, true)) return { ok: false, reason: "not allowed" };
  if (!canDoChoreYet(viewer, instance.dueDate)) return { ok: false, reason: "not yet" };
  // Phase 70c: a kid's tick on a chore a grown-up checks waits for the OK: done, but no completedAt
  // and no stickers yet (everything that pays or counts keys on completedAt).
  if (instance.definition.needsCheck && !viewer.adult) {
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "PENDING", assignedToId: instance.assignedToId },
      data: { status: "DONE", completedAt: null, completedById: viewer.id, awaitingCheck: true },
    });
    if (count === 0) return { ok: false, reason: "changed" };
    await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", fromValue: "PENDING", toValue: "WAITING" });
    return { ok: true, waiting: true };
  }
  return pay(tx, viewer, instanceId, instance.assignedToId ?? viewer.id, instance.definition.points, instance.definition.title, {
    where: { id: instanceId, status: "PENDING", assignedToId: instance.assignedToId },
    data: { status: "DONE", completedAt: new Date(), completedById: viewer.id },
  });
}

/** Marks a chore paid (the guarded update it's given), then stickers and the milestone crossed. */
async function pay(
  tx: Tx,
  viewer: ChoreViewer,
  instanceId: string,
  pointsRecipient: string,
  points: number,
  title: string,
  update: Prisma.TaskInstanceUpdateManyArgs,
  event: { fromValue: string; toValue: string } = { fromValue: "PENDING", toValue: "DONE" },
): Promise<CoreResult & { milestone?: number | null }> {
  const { count } = await tx.taskInstance.updateMany(update);
  if (count === 0) return { ok: false, reason: "changed" };
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", ...event });
  // Counted inside the transaction, so in a bulk Done each completion sees the ones before it.
  const priorCompletions = await tx.pointsLedger.count({
    where: { personId: pointsRecipient, instanceId: { not: null }, instance: { definition: { domain: "CHORE" } } },
  });
  await tx.pointsLedger.create({ data: { personId: pointsRecipient, delta: points, reason: title, instanceId } });
  return { ok: true, milestone: milestoneCrossed(priorCompletions, priorCompletions + 1) };
}

/**
 * Phase 70c: a grown-up's check on a chore a kid ticked. **OK** pays its stickers now (to whoever it
 * was for, else whoever did it); **Not yet** puts it back to do, with nothing to take back. Never by
 * a kid.
 */
export async function checkChore(tx: Tx, viewer: ChoreViewer, instanceId: string, ok: boolean): Promise<CoreResult & { milestone?: number | null }> {
  if (!viewer.adult) return { ok: false, reason: "not allowed" };
  const instance = await find(tx, viewer, instanceId);
  if (!instance) return { ok: false, reason: "not found" };
  if (instance.status !== "DONE" || !instance.awaitingCheck) return { ok: false, reason: "changed" };
  const waiting = { id: instanceId, status: "DONE" as const, awaitingCheck: true, completedById: instance.completedById };
  if (!ok) {
    const { count } = await tx.taskInstance.updateMany({ where: waiting, data: { status: "PENDING", awaitingCheck: false, completedById: null, completedAt: null } });
    if (count === 0) return { ok: false, reason: "changed" };
    await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", fromValue: "WAITING", toValue: "PENDING" });
    return { ok: true };
  }
  return pay(
    tx,
    viewer,
    instanceId,
    instance.assignedToId ?? instance.completedById ?? viewer.id,
    instance.definition.points,
    instance.definition.title,
    { where: waiting, data: { awaitingCheck: false, completedAt: new Date() } },
    { fromValue: "WAITING", toValue: "CHECKED" },
  );
}

/** Undo a Done (or a tick waiting for a check): pinned to the completion that was seen, and its stickers go back. */
export async function uncompleteChore(tx: Tx, viewer: ChoreViewer, instanceId: string): Promise<CoreResult> {
  const instance = await find(tx, viewer, instanceId);
  if (!instance) return { ok: false, reason: "not found" };
  if (!canUndoChore(viewer, instance)) return { ok: false, reason: "not allowed" };
  const { count } = await tx.taskInstance.updateMany({
    // A chore waiting for a check has no completedAt yet: pinned to who ticked it instead.
    where: { id: instanceId, status: "DONE", completedAt: instance.completedAt, awaitingCheck: instance.awaitingCheck, completedById: instance.completedById },
    data: { status: "PENDING", completedAt: null, completedById: null, awaitingCheck: false },
  });
  if (count === 0) return { ok: false, reason: "changed" };
  await tx.pointsLedger.deleteMany({ where: { instanceId } });
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", fromValue: "DONE", toValue: "PENDING" });
  return { ok: true };
}

/** Give to someone else: a grown-up, a still-pending chore, a member of the household. */
export async function reassignChore(tx: Tx, viewer: ChoreViewer, instanceId: string, target: { id: string; firstName: string }): Promise<CoreResult> {
  if (!viewer.adult) return { ok: false, reason: "not allowed" };
  const instance = await find(tx, viewer, instanceId);
  if (!instance) return { ok: false, reason: "not found" };
  if (instance.status !== "PENDING") return { ok: false, reason: "already done" };
  // Already theirs: nothing to change, and a bulk hand-off says so rather than counting it.
  if (instance.assignedToId === target.id) return { ok: false, reason: "already done" };
  const { count } = await tx.taskInstance.updateMany({
    where: { id: instanceId, status: "PENDING", assignedToId: instance.assignedToId },
    data: { assignedToId: target.id },
  });
  if (count === 0) return { ok: false, reason: "changed" };
  await recordEvent(tx, {
    householdId: viewer.householdId,
    itemType: "CHORE",
    itemId: instanceId,
    actorId: viewer.id,
    action: "ASSIGN",
    fromValue: instance.assignedTo?.firstName ?? null,
    toValue: target.firstName,
  });
  return { ok: true };
}

/** Skip (Missed, once it's past): nobody did it, so nobody gets stickers. Grown-ups only. */
export async function skipChore(tx: Tx, viewer: ChoreViewer, instanceId: string): Promise<CoreResult> {
  if (!canSkipChore(viewer)) return { ok: false, reason: "not allowed" };
  if (!(await skipTask({ householdId: viewer.householdId, domain: "CHORE", instanceId, byId: viewer.id, db: tx }))) return { ok: false, reason: "already done" };
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", fromValue: "PENDING", toValue: "SKIPPED" });
  return { ok: true };
}

export async function unskipChore(tx: Tx, viewer: ChoreViewer, instanceId: string): Promise<CoreResult> {
  if (!canSkipChore(viewer)) return { ok: false, reason: "not allowed" };
  if (!(await unskipTask({ householdId: viewer.householdId, domain: "CHORE", instanceId, db: tx }))) return { ok: false, reason: "changed" };
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: instanceId, actorId: viewer.id, action: "STATUS", fromValue: "SKIPPED", toValue: "PENDING" });
  return { ok: true };
}
