import { describe, expect, test } from "vitest";
import { planInstances, type TaskDefinitionLike } from "./instances";
import type { PriorInstance } from "./assignment";

function def(overrides: Partial<TaskDefinitionLike>): TaskDefinitionLike {
  return {
    frequencyType: "DAILY",
    startDate: new Date(2026, 0, 1),
    interval: null,
    daysOfWeek: [],
    timesOfDay: [],
    assignmentStrategy: "FIXED",
    ...overrides,
  };
}

describe("planInstances — single-dose (chores) regression coverage", () => {
  test(
    "regenerating the latest existing instance's day does not double-count it for " +
      "LEAST_ASSIGNED — the bug an earlier version of this function had",
    () => {
      // A has 5 prior assignments, B has 4, and the single most recent instance (Jan 9) went
      // to B. The correct next pick (Jan 10, the only genuinely new day) is B (4 < 5). A
      // version that unconditionally regenerates Jan 9 without an existing-dueDate check would
      // re-push Jan 9 into the fairness count, making B look like 5 too and wrongly tie-break
      // to A.
      const existing: PriorInstance[] = [
        { assignedToId: "A", dueDate: new Date(2026, 0, 1) },
        { assignedToId: "A", dueDate: new Date(2026, 0, 2) },
        { assignedToId: "B", dueDate: new Date(2026, 0, 3) },
        { assignedToId: "A", dueDate: new Date(2026, 0, 4) },
        { assignedToId: "B", dueDate: new Date(2026, 0, 5) },
        { assignedToId: "A", dueDate: new Date(2026, 0, 6) },
        { assignedToId: "B", dueDate: new Date(2026, 0, 7) },
        { assignedToId: "A", dueDate: new Date(2026, 0, 8) },
        { assignedToId: "B", dueDate: new Date(2026, 0, 9) },
      ];
      const d = def({ startDate: new Date(2026, 0, 1), assignmentStrategy: "LEAST_ASSIGNED" });

      const planned = planInstances(d, existing, ["A", "B"], new Date(2026, 0, 10), new Date(2026, 0, 10));

      expect(planned).toEqual([{ dueDate: new Date(2026, 0, 10), assignedToId: "B" }]);
    },
  );

  test(
    "a manual reassignment (app/(app)/chores/actions.ts's reassignInstance, which writes " +
      "assignedToId directly and never goes through planInstances) changes who counts as " +
      "least-assigned for every LEAST_ASSIGNED pick made afterward — there is no separate " +
      "'original assignee' field, so the fairness count is only ever the current assignedToId",
    () => {
      // Jan 2 was generated for B but has since been reassigned to A, so the existing rows
      // read back from the DB already show A on both Jan 1 and Jan 2. That makes A=2, B=1,
      // so the next fair pick (Jan 4) goes to B — the opposite of what it would have been
      // (A=1, B=2 → A picked) had the reassignment never happened.
      const existing: PriorInstance[] = [
        { assignedToId: "A", dueDate: new Date(2026, 0, 1) },
        { assignedToId: "A", dueDate: new Date(2026, 0, 2) },
        { assignedToId: "B", dueDate: new Date(2026, 0, 3) },
      ];
      const d = def({ startDate: new Date(2026, 0, 1), assignmentStrategy: "LEAST_ASSIGNED" });

      const planned = planInstances(d, existing, ["A", "B"], new Date(2026, 0, 4), new Date(2026, 0, 4));

      expect(planned).toEqual([{ dueDate: new Date(2026, 0, 4), assignedToId: "B" }]);
    },
  );

  test("never re-creates an already-existing dueDate", () => {
    const existing: PriorInstance[] = [{ assignedToId: "A", dueDate: new Date(2026, 0, 5) }];
    const d = def({ startDate: new Date(2026, 0, 1) });

    const planned = planInstances(d, existing, ["A"], new Date(2026, 0, 5), new Date(2026, 0, 5));

    expect(planned).toEqual([]);
  });

  test("with no prior instances, plans from startDate through the horizon", () => {
    const d = def({ startDate: new Date(2026, 0, 1) });

    const planned = planInstances(d, [], ["A"], new Date(2026, 0, 1), new Date(2026, 0, 3));

    expect(planned).toEqual([
      { dueDate: new Date(2026, 0, 1), assignedToId: "A" },
      { dueDate: new Date(2026, 0, 2), assignedToId: "A" },
      { dueDate: new Date(2026, 0, 3), assignedToId: "A" },
    ]);
  });

  test(
    "backfills a gap left by deleting future PENDING instances while a later DONE " +
      "instance survives — the exact shape app/(app)/meds/actions.ts's updateTaskDefinition " +
      "creates (it deletes future PENDING rows on edit, but leaves DONE ones alone), which " +
      "an earlier version of this function (anchored only at `latest`, never floored at " +
      "`today`) would have left permanently unfilled",
    () => {
      // Jan 6 was completed early and survived the edit's deleteMany; Jan 1-5 and Jan 7
      // were deleted and must be regenerated even though Jan 6 (the only remaining/latest
      // instance) is in the future relative to today (Jan 1).
      const existing: PriorInstance[] = [{ assignedToId: "kid", dueDate: new Date(2026, 0, 6) }];
      const d = def({ startDate: new Date(2026, 0, 1) });

      const planned = planInstances(d, existing, ["kid"], new Date(2026, 0, 1), new Date(2026, 0, 7));

      expect(planned.map((p) => p.dueDate)).toEqual([
        new Date(2026, 0, 1),
        new Date(2026, 0, 2),
        new Date(2026, 0, 3),
        new Date(2026, 0, 4),
        new Date(2026, 0, 5),
        // Jan 6 skipped — already exists (existingTimes)
        new Date(2026, 0, 7),
      ]);
    },
  );
});

describe("planInstances — multi-dose (meds) scheduling", () => {
  test("expands each day into one instance per timesOfDay entry", () => {
    const d = def({ startDate: new Date(2026, 0, 1), timesOfDay: ["08:00", "20:00"] });

    const planned = planInstances(d, [], ["kid"], new Date(2026, 0, 1), new Date(2026, 0, 1));

    expect(planned).toEqual([
      { dueDate: new Date(2026, 0, 1, 8, 0), assignedToId: "kid" },
      { dueDate: new Date(2026, 0, 1, 20, 0), assignedToId: "kid" },
    ]);
  });

  test(
    "plans the remaining dose(s) for today when an earlier dose the same day already " +
      "exists — the exact case that motivated regenerating latest's calendar day",
    () => {
      const existing: PriorInstance[] = [
        { assignedToId: "kid", dueDate: new Date(2026, 0, 1, 8, 0) },
      ];
      const d = def({ startDate: new Date(2026, 0, 1), timesOfDay: ["08:00", "20:00"] });

      const planned = planInstances(d, existing, ["kid"], new Date(2026, 0, 1), new Date(2026, 0, 1));

      expect(planned).toEqual([{ dueDate: new Date(2026, 0, 1, 20, 0), assignedToId: "kid" }]);
    },
  );
});
