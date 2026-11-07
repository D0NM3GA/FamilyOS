import { eventDate, type EventInput } from "./events";

/**
 * Phase 59.1c: what an assignment edit changed, as history events (minus who, where and which
 * item, which the action adds). Pure. A note's text never goes in, only that it changed.
 */
type AssignmentSnapshot = {
  className: string;
  title: string;
  kind: string;
  dueDate: Date | null;
  notes: string | null;
  status: string;
  score: number | null;
  maxScore: number | null;
};

type Change = Omit<EventInput, "householdId" | "itemId" | "actorId">;

const grade = (score: number | null, max: number | null) => (score == null ? null : max == null ? `${score}` : `${score}/${max}`);

export function assignmentChanges(before: AssignmentSnapshot, after: AssignmentSnapshot): Change[] {
  const changes: Change[] = [];
  const edit = (field: string, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ itemType: "ASSIGNMENT", action: "EDIT", field, fromValue: from, toValue: to });
  };
  edit("title", before.title, after.title);
  edit("className", before.className, after.className);
  edit("kind", before.kind, after.kind);
  edit("dueDate", eventDate(before.dueDate), eventDate(after.dueDate));
  if ((before.notes ?? "") !== (after.notes ?? "")) changes.push({ itemType: "ASSIGNMENT", action: "EDIT", field: "notes" });
  if (before.status !== after.status) changes.push({ itemType: "ASSIGNMENT", action: "STATUS", fromValue: before.status, toValue: after.status });
  const g0 = grade(before.score, before.maxScore);
  const g1 = grade(after.score, after.maxScore);
  if (g0 !== g1) changes.push({ itemType: "ASSIGNMENT", action: "GRADE", fromValue: g0, toValue: g1 });
  return changes;
}
