/**
 * Phase 66a: whether an edit changes when a task happens or who does it. When it does, the days
 * already planned ahead (up to two weeks) were made from the old schedule and pool, so they go
 * and the planner makes new ones; a title, notes or points edit keeps them, and with them any
 * reassignment made by hand.
 */
export type ScheduleFields = {
  frequencyType: string;
  interval: number | null;
  daysOfWeek: number[];
  startDate: Date;
  timesOfDay?: string[];
  assignmentStrategy: string;
};

export function scheduleChanged(
  before: ScheduleFields & { assigneeIds: string[] },
  after: ScheduleFields & { assigneeIds: string[] },
): boolean {
  const sameList = (a: readonly (string | number)[], b: readonly (string | number)[]) => {
    const x = [...a].map(String).sort();
    const y = [...b].map(String).sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  return (
    before.frequencyType !== after.frequencyType ||
    (before.interval ?? null) !== (after.interval ?? null) ||
    !sameList(before.daysOfWeek, after.daysOfWeek) ||
    before.startDate.getTime() !== after.startDate.getTime() ||
    !sameList(before.timesOfDay ?? [], after.timesOfDay ?? []) ||
    before.assignmentStrategy !== after.assignmentStrategy ||
    !sameList(before.assigneeIds, after.assigneeIds)
  );
}
