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

/** Phase 59.2a: the fields a kid may change, which Put back can restore. */
export const KID_EDITABLE = ["title", "className", "kind", "dueDate"] as const;
export type KidEditable = (typeof KID_EDITABLE)[number];

/**
 * Put back: each field the student changed since a grown-up last approved or put back, with the
 * value it had before their first change. `events` are the item's, oldest first.
 */
export function putBackValues(
  events: { action: string; field: string | null; fromValue: string | null; actorId: string | null }[],
  studentId: string,
): Partial<Record<KidEditable, string | null>> {
  const lastReview = events.map((e) => e.action).lastIndexOf("APPROVE");
  const lastPutBack = events.map((e) => e.action).lastIndexOf("PUT_BACK");
  const since = events.slice(Math.max(lastReview, lastPutBack) + 1);
  const out: Partial<Record<KidEditable, string | null>> = {};
  for (const e of since) {
    if (e.action !== "EDIT" || e.actorId !== studentId || !e.field) continue;
    if (!(KID_EDITABLE as readonly string[]).includes(e.field)) continue;
    const field = e.field as KidEditable;
    if (!(field in out)) out[field] = e.fromValue;
  }
  return out;
}

type TaskSnapshot = {
  title: string;
  kind: string;
  kid: string | null;
  owner: string | null;
  dueDate: Date | null;
  amount: string | null;
  notes: string | null;
};

/** Phase 59.2a: what a form edit changed. People by first name; a note only says it changed. */
export function taskChanges(before: TaskSnapshot, after: TaskSnapshot): Change[] {
  const changes: Change[] = [];
  const edit = (field: string, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ itemType: "SCHOOL_TASK", action: "EDIT", field, fromValue: from, toValue: to });
  };
  edit("title", before.title, after.title);
  edit("kind", before.kind, after.kind);
  edit("kid", before.kid, after.kid);
  if (before.owner !== after.owner) changes.push({ itemType: "SCHOOL_TASK", action: "ASSIGN", fromValue: before.owner, toValue: after.owner });
  edit("dueDate", eventDate(before.dueDate), eventDate(after.dueDate));
  edit("amount", before.amount, after.amount);
  if ((before.notes ?? "") !== (after.notes ?? "")) changes.push({ itemType: "SCHOOL_TASK", action: "EDIT", field: "notes" });
  return changes;
}
