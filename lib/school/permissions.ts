import { isAdult } from "@/lib/roles";

/**
 * School's who-may-do-what (Phase 18), pulled out of the actions in Phase 59.1a so the actions and
 * the status pill can't disagree. Pure.
 */

type Viewer = { id: string; role: "ADMIN" | "ADULT" | "KID" | null };
export type AssignmentStatusValue = "TODO" | "DONE" | "MISSING";

/** Adults see every student; a kid sees only themselves, since grades are personal. */
export function canSeeStudent(viewer: Viewer, personId: string): boolean {
  return isAdult(viewer) || viewer.id === personId;
}

/**
 * A grown-up may move work between any statuses. A kid may tick their own off and back, but
 * "missing" is a grown-up's: a kid can't set it, and can't clear it by ticking the work off.
 */
export function canSetAssignmentStatus(
  viewer: Viewer,
  a: { studentId: string; status: AssignmentStatusValue },
  to: AssignmentStatusValue,
): boolean {
  if (!canSeeStudent(viewer, a.studentId)) return false;
  if (isAdult(viewer)) return true;
  return to !== "MISSING" && a.status !== "MISSING";
}

/**
 * Phase 59.2a (the owner's call, 2026-11-07): a kid may change the title, class, type and due date
 * of their own work, but not once it's missing or graded; a grown-up reviews what they changed.
 */
export function canEditAssignmentDetails(viewer: Viewer, a: { studentId: string; status: AssignmentStatusValue; score: number | null }): boolean {
  if (!canSeeStudent(viewer, a.studentId)) return false;
  return isAdult(viewer) || (a.score == null && a.status !== "MISSING");
}

/** Kids can remove their own homework, not a grade or a "missing" a grown-up recorded. */
export function canRemoveAssignment(viewer: Viewer, a: { studentId: string; status: AssignmentStatusValue; score: number | null }): boolean {
  if (!canSeeStudent(viewer, a.studentId)) return false;
  return isAdult(viewer) || (a.score == null && a.status !== "MISSING");
}
