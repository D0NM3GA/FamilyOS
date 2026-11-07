import { isAdult } from "@/lib/roles";
import { atMidnight } from "@/lib/tasks/schedule";
import { dueLook, type PillLook, type Viewer, type WorkItem } from "./types";

type SchoolTaskStatusValue = "OPEN" | "DONE";

export type SchoolTaskLike = {
  id: string;
  title: string;
  dueDate: Date | null;
  status: SchoolTaskStatusValue;
  owner: { id: string; firstName: string } | null;
};

/** A form to sign, a fee, supplies: grown-ups only, open or done. */
export function schoolTaskItem(t: SchoolTaskLike, viewer: Viewer, now: Date = new Date()): WorkItem<SchoolTaskStatusValue> {
  const today = atMidnight(now);
  const late = t.dueDate != null && t.dueDate < today;
  const looks: Record<SchoolTaskStatusValue, PillLook> = {
    OPEN: dueLook(t.dueDate, today, late),
    DONE: { status: "DONE", label: "Done", tone: "done" },
  };
  const adult = isAdult(viewer);
  return {
    type: "SCHOOL_TASK",
    id: t.id,
    title: t.title,
    who: t.owner,
    due: t.dueDate,
    status: t.status,
    looks,
    options: adult ? { OPEN: [{ value: "DONE", label: "Done" }], DONE: [{ value: "OPEN", label: "Reopen" }] } : {},
  };
}
