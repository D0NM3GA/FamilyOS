import type { Prisma } from "@/app/generated/prisma/client";
import { recordEvent } from "@/lib/work-items/events";
import { canSetAssignmentStatus, type AssignmentStatusValue } from "./permissions";
import { isAdult } from "@/lib/roles";

/**
 * Phase 59.3: one assignment's or form's status change inside a transaction it's handed, so the
 * single action and the bulk one apply exactly the same rules. Refusals are said, not thrown.
 */

type Tx = Prisma.TransactionClient;
type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };
export type SchoolCoreResult = { ok: true } | { ok: false; reason: "not found" | "not allowed" | "already done" | "changed" };

export async function setAssignmentStatusIn(tx: Tx, viewer: Viewer, assignmentId: string, status: AssignmentStatusValue): Promise<SchoolCoreResult> {
  const existing = await tx.schoolAssignment.findFirst({
    where: { id: assignmentId, profile: { person: { householdId: viewer.householdId } } },
    select: { status: true, profile: { select: { personId: true } } },
  });
  if (!existing) return { ok: false, reason: "not found" };
  // A teacher's "missing" is set and cleared by a grown-up, not by the student.
  if (!canSetAssignmentStatus(viewer, { studentId: existing.profile.personId, status: existing.status }, status)) return { ok: false, reason: "not allowed" };
  // No change, no write: ticking off done work again mustn't move when it was finished.
  if (existing.status === status) return { ok: false, reason: "already done" };
  // Pinned to the status that was checked, so a change racing this one can't be misrecorded.
  const { count } = await tx.schoolAssignment.updateMany({
    where: { id: assignmentId, status: existing.status },
    data: { status, doneAt: status === "DONE" ? new Date() : null },
  });
  if (count === 0) return { ok: false, reason: "changed" };
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "ASSIGNMENT", itemId: assignmentId, actorId: viewer.id, action: "STATUS", fromValue: existing.status, toValue: status });
  return { ok: true };
}

/** A form, fee or to-do ticked off or reopened: grown-ups only, and only a real change. */
export async function setTaskDoneIn(tx: Tx, viewer: Viewer, taskId: string, done: boolean): Promise<SchoolCoreResult> {
  if (!isAdult(viewer)) return { ok: false, reason: "not allowed" };
  const to = done ? "DONE" : "OPEN";
  const { count } = await tx.schoolTask.updateMany({
    where: { id: taskId, householdId: viewer.householdId, status: done ? "OPEN" : "DONE" },
    data: { status: to, doneAt: done ? new Date() : null },
  });
  if (count === 0) return { ok: false, reason: "already done" };
  await recordEvent(tx, { householdId: viewer.householdId, itemType: "SCHOOL_TASK", itemId: taskId, actorId: viewer.id, action: "STATUS", fromValue: done ? "OPEN" : "DONE", toValue: to });
  return { ok: true };
}
