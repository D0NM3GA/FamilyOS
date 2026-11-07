import type { WorkItemType } from "./types";

/**
 * Phase 59.4a: an item's history, in words, for the side panel. Pure: the panel reads the events
 * (lib/work-items/panel.ts) and this says what each one means.
 */

export type ItemRef = { type: WorkItemType; id: string };

/** "?item=CHORE:abc" → { type, id }; anything else is no item. */
export function parseItemRef(raw: string | undefined | null): ItemRef | null {
  if (!raw || raw.length > 80) return null;
  const m = /^(CHORE|ASSIGNMENT|SCHOOL_TASK):([A-Za-z0-9_-]{1,64})$/.exec(raw);
  return m ? { type: m[1] as WorkItemType, id: m[2] } : null;
}

export const itemParam = (type: WorkItemType, id: string) => `${type}:${id}`;

const STATUS_WORD: Record<string, string> = {
  PENDING: "to do",
  DONE: "done",
  SKIPPED: "skipped",
  TODO: "to do",
  MISSING: "missing",
  OPEN: "open",
};

const FIELD_WORD: Record<string, string> = {
  title: "the name",
  className: "the class",
  kind: "the type",
  dueDate: "the due date",
  notes: "the notes",
  kid: "who it's for",
  amount: "the amount",
};

const KIND_WORD: Record<string, string> = { HOMEWORK: "homework", TEST: "test", QUIZ: "quiz", PROJECT: "project", FORM: "form", FEE: "fee", SUPPLIES: "supplies", OTHER: "to-do" };

type EventLike = { itemType: string; action: string; field: string | null; fromValue: string | null; toValue: string | null };

/** "marked it done", "gave it to Max", "changed the due date from Nov 9 to Nov 12". */
export function describeEvent(e: EventLike): string {
  const status = (v: string | null) => {
    if (v == null) return "nothing";
    if (e.itemType === "ASSIGNMENT" && v === "DONE") return "turned in";
    return STATUS_WORD[v] ?? v.toLowerCase();
  };
  const value = (v: string | null) => {
    if (v == null) return "none";
    if (e.field === "kind") return KIND_WORD[v] ?? v.toLowerCase();
    if (e.field === "dueDate" || e.action === "MOVE") return shortDate(v);
    return `"${v}"`;
  };
  switch (e.action) {
    case "STATUS":
      return `marked it ${status(e.toValue)}`;
    case "ASSIGN":
      return e.toValue ? `gave it to ${e.toValue}${e.fromValue ? ` (was ${e.fromValue})` : " (was anyone's)"}` : "made it anyone's";
    case "MOVE":
      return `moved it from ${value(e.fromValue)} to ${value(e.toValue)}`;
    case "GRADE":
      return e.toValue ? `graded it ${e.toValue}${e.fromValue ? ` (was ${e.fromValue})` : ""}` : "took the grade off";
    case "APPROVE":
      return "approved the change";
    case "PUT_BACK":
      return e.field ? `put back ${FIELD_WORD[e.field] ?? e.field} to ${value(e.toValue)}` : "put back the change";
    case "EDIT": {
      const what = FIELD_WORD[e.field ?? ""] ?? "it";
      if (e.field === "notes") return "changed the notes";
      return `changed ${what} from ${value(e.fromValue)} to ${value(e.toValue)}`;
    }
    default:
      return "changed it";
  }
}

/** "2026-11-12" → "Nov 12", without a time zone getting involved. */
function shortDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}
