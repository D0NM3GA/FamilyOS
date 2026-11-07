import { isOverdue } from "@/lib/school/rules";
import { canSetAssignmentStatus, type AssignmentStatusValue } from "@/lib/school/permissions";
import { atMidnight } from "@/lib/tasks/schedule";
import { dueLook, type PillLook, type StatusOption, type Viewer, type WorkItem } from "./types";

export type AssignmentLike = {
  id: string;
  title: string;
  dueDate: Date | null;
  status: AssignmentStatusValue;
  score: number | null;
  maxScore: number | null;
  student: { id: string; firstName: string };
};

const STATUSES: AssignmentStatusValue[] = ["TODO", "DONE", "MISSING"];
const OPTION_LABEL: Record<AssignmentStatusValue, string> = { TODO: "To do", DONE: "Turned in", MISSING: "Missing" };

/** "18/20", without a trailing ".0". */
function scoreText(score: number, max: number | null): string {
  return max == null ? `${score}` : `${score}/${max}`;
}

/**
 * Homework, tests and projects. The stored status wins and a score is a suffix: done with a score
 * is "Graded 18/20", done without is "Turned in", and missing stays "Missing" even with a score.
 */
export function assignmentItem(a: AssignmentLike, viewer: Viewer, now: Date = new Date()): WorkItem<AssignmentStatusValue> {
  const today = atMidnight(now);
  const looks: Record<AssignmentStatusValue, PillLook> = {
    TODO: dueLook(a.dueDate, today, isOverdue({ status: "TODO", dueDate: a.dueDate }, now)),
    DONE:
      a.score != null
        ? { status: "GRADED", label: `Graded ${scoreText(a.score, a.maxScore)}`, tone: "done" }
        : { status: "TURNED_IN", label: "Turned in", tone: "done" },
    MISSING: { status: "MISSING", label: "Missing", tone: "late" },
  };
  const options = Object.fromEntries(
    STATUSES.map((from) => [
      from,
      STATUSES.filter((to) => to !== from && canSetAssignmentStatus(viewer, { studentId: a.student.id, status: from }, to)).map(
        (to): StatusOption<AssignmentStatusValue> => ({ value: to, label: OPTION_LABEL[to] }),
      ),
    ]),
  ) as Record<AssignmentStatusValue, StatusOption<AssignmentStatusValue>[]>;

  // Only an id and a first name reach the browser, whatever row the caller handed in.
  const who = { id: a.student.id, firstName: a.student.firstName };
  return { type: "ASSIGNMENT", id: a.id, title: a.title, who, due: a.dueDate, status: a.status, looks, options };
}
