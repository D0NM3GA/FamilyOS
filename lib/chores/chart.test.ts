import { describe, expect, test } from "vitest";
import { ANYONE, buildHouseholdGrid, buildPersonCharts, type ChartInstance } from "./chart";

const start = new Date(2026, 8, 22); // Tue Sep 22 2026, local midnight
const day = (offset: number, hour = 0) => new Date(2026, 8, 22 + offset, hour);
const kid1 = { id: "k1", firstName: "Kid One" };
const kid2 = { id: "k2", firstName: "Kid Two" };
const bed = { id: "d-bed", title: "Make bed", points: 2 };
const trash = { id: "d-trash", title: "Take out trash", points: 5 };

function inst(
  dueDate: Date,
  assignedTo: ChartInstance["assignedTo"],
  definition: ChartInstance["definition"],
  status: ChartInstance["status"] = "PENDING",
): ChartInstance {
  return { dueDate, assignedTo, definition, status };
}

describe("buildPersonCharts", () => {
  test("rotating chores land on whoever the generated instance names, day by day", () => {
    // ROUND_ROBIN: trash alternates kids — only the instances know that.
    const charts = buildPersonCharts(
      [inst(day(0), kid1, trash), inst(day(1), kid2, trash), inst(day(2), kid1, trash)],
      start,
    );
    expect(charts.map((c) => c.name)).toEqual(["Kid One", "Kid Two"]);
    expect(charts[0].rows[0].cells.slice(0, 3)).toEqual([{ due: 1, done: 0 }, null, { due: 1, done: 0 }]);
    expect(charts[1].rows[0].cells.slice(0, 3)).toEqual([null, { due: 1, done: 0 }, null]);
  });

  test("unassigned instances go to an 'Anyone' chart, sorted last", () => {
    const charts = buildPersonCharts([inst(day(0), null, bed), inst(day(0), kid2, trash)], start);
    expect(charts.map((c) => c.name)).toEqual(["Kid Two", ANYONE]);
    expect(charts[1].personId).toBeNull();
  });

  test("counts done, ignores SKIPPED and anything outside the 7-day window", () => {
    const charts = buildPersonCharts(
      [
        inst(day(0), kid1, bed, "DONE"),
        inst(day(1), kid1, bed, "SKIPPED"),
        inst(day(-1), kid1, bed),
        inst(day(7), kid1, bed),
      ],
      start,
    );
    expect(charts[0].rows[0].cells).toEqual([{ due: 1, done: 1 }, null, null, null, null, null, null]);
  });

  test("a time-of-day dueDate still lands on its calendar day", () => {
    const charts = buildPersonCharts([inst(day(3, 18), kid1, bed)], start);
    expect(charts[0].rows[0].cells[3]).toEqual({ due: 1, done: 0 });
  });

  test("two instances of one chore on the same day count as 2", () => {
    const charts = buildPersonCharts([inst(day(0), kid1, bed), inst(day(0), kid1, bed, "DONE")], start);
    expect(charts[0].rows[0].cells[0]).toEqual({ due: 2, done: 1 });
  });
});

describe("buildHouseholdGrid", () => {
  test("rows are chores; each cell lists who's on it that day, with done status", () => {
    const grid = buildHouseholdGrid(
      [inst(day(0), kid2, trash), inst(day(0), kid1, trash, "DONE"), inst(day(1), null, bed)],
      start,
    );
    expect(grid.map((r) => r.title)).toEqual(["Make bed", "Take out trash"]);
    expect(grid[1].cells[0]).toEqual([
      { name: "Kid One", done: true },
      { name: "Kid Two", done: false },
    ]);
    expect(grid[0].cells[1]).toEqual([{ name: ANYONE, done: false }]);
  });

  test("ignores SKIPPED and anything outside the 7-day window, same as the per-person charts", () => {
    const grid = buildHouseholdGrid(
      [inst(day(0), kid1, bed, "SKIPPED"), inst(day(-1), kid1, bed), inst(day(7), kid1, bed), inst(day(2), kid1, bed)],
      start,
    );
    expect(grid[0].cells.map((c) => c.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });
});
