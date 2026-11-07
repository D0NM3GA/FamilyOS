import { addDays } from "./schedule";

/**
 * Phase 59.3: which chores the two presets act on, for the person the board is filtered to. Pure.
 * Sick day: what they still have due today. Hand off: what they still have today and tomorrow.
 * Neither touches overdue ones, "Anyone" ones, or what's already done or skipped.
 */
type Row = { id: string; status: string; assignedToId: string | null; dueDate: Date };

export function presetIds(board: { dueToday: Row[]; upcoming: Row[] }, personId: string, today: Date) {
  const theirs = (i: Row) => i.status === "PENDING" && i.assignedToId === personId;
  const tomorrow = addDays(today, 1);
  return {
    sickDayIds: board.dueToday.filter(theirs).map((i) => i.id),
    handOffIds: [...board.dueToday, ...board.upcoming].filter((i) => theirs(i) && i.dueDate <= tomorrow).map((i) => i.id),
  };
}
