import { isAdult } from "@/lib/roles";
import { canDoChore, canDoChoreYet, canSkipChore, canUndoChore } from "@/lib/tasks/permissions";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { dueLook, type PillLook, type StatusOption, type Viewer, type WorkItem } from "./types";

type ChoreStatusValue = "PENDING" | "DONE" | "SKIPPED";

export type ChoreLike = {
  id: string;
  dueDate: Date;
  status: ChoreStatusValue;
  completedAt: Date | null;
  definition: { title: string };
  assignedTo: { id: string; firstName: string } | null;
  completedBy: { id: string; firstName: string } | null;
};

/**
 * A chore. A skipped one reads "Missed" when it was skipped after its day (the overdue board's
 * "Missed"), "Skipped" when it was skipped ahead of time; both are SKIPPED in the database.
 * `skippable` is whether this board offers Skip at all (Chores' Upcoming fold doesn't).
 *
 * Overdue here is any pending chore before today: the caller has already applied the board's
 * window (`overdueSince`, lib/tasks/skip.ts), so pass only what that board lists.
 */
export function choreItem(
  i: ChoreLike,
  viewer: Viewer,
  opts: { skippable: boolean; now?: Date },
): WorkItem<ChoreStatusValue> {
  const today = atMidnight(opts.now ?? new Date());
  const overdue = i.dueDate < today;
  const who = { id: viewer.id, adult: isAdult(viewer) };

  // Stored skips know when they happened; a skip made from here happens today.
  const skippedLate = i.status === "SKIPPED" && i.completedAt ? i.completedAt >= addDays(i.dueDate, 1) : overdue;
  const looks: Record<ChoreStatusValue, PillLook> = {
    PENDING: dueLook(i.dueDate, today, overdue),
    DONE: { status: "DONE", label: "Done", tone: "done" },
    SKIPPED: skippedLate ? { status: "MISSED", label: "Missed", tone: "quiet" } : { status: "SKIPPED", label: "Skipped", tone: "quiet" },
  };

  const pending: StatusOption<ChoreStatusValue>[] = [];
  if (canDoChore(who, { assignedToId: i.assignedTo?.id ?? null }, true) && canDoChoreYet(who, i.dueDate, opts.now)) pending.push({ value: "DONE", label: "Done" });
  if (opts.skippable && canSkipChore(who)) pending.push({ value: "SKIPPED", label: overdue ? "Missed" : "Skip" });

  // Done from here means done by the viewer, so they may undo it.
  const doneBy = i.status === "DONE" ? (i.completedBy?.id ?? null) : viewer.id;
  const options: Record<ChoreStatusValue, StatusOption<ChoreStatusValue>[]> = {
    PENDING: pending,
    DONE: canUndoChore(who, { completedById: doneBy }) ? [{ value: "PENDING", label: "Undo" }] : [],
    SKIPPED: opts.skippable && canSkipChore(who) ? [{ value: "PENDING", label: "Undo skip" }] : [],
  };

  return {
    type: "CHORE",
    id: i.id,
    title: i.definition.title,
    who: i.assignedTo ? { id: i.assignedTo.id, firstName: i.assignedTo.firstName } : null,
    due: i.dueDate,
    status: i.status,
    looks,
    options,
  };
}
