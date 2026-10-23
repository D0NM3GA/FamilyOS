import { describe, expect, test } from "vitest";
import { bucketInstances } from "./queries";

type I = { id: string; status: "PENDING" | "DONE" | "SKIPPED"; dueDate: Date };

const today = new Date(2026, 2, 10); // midnight
const horizonExclusive = new Date(2026, 2, 14); // exclusive — i.e. horizon day is Mar 13

describe("bucketInstances", () => {
  test("a midnight-only dueDate (chores) buckets exactly as a strict-equality check would", () => {
    const instances: I[] = [
      { id: "yesterday", status: "PENDING", dueDate: new Date(2026, 2, 9) },
      { id: "today", status: "PENDING", dueDate: new Date(2026, 2, 10) },
      { id: "tomorrow", status: "PENDING", dueDate: new Date(2026, 2, 11) },
    ];
    const { overdue, dueToday, upcoming } = bucketInstances(instances, today, horizonExclusive);
    expect(overdue.map((i) => i.id)).toEqual(["yesterday"]);
    expect(dueToday.map((i) => i.id)).toEqual(["today"]);
    expect(upcoming.map((i) => i.id)).toEqual(["tomorrow"]);
  });

  test("a timed dueDate (meds) later today lands in dueToday, not upcoming", () => {
    const instances: I[] = [{ id: "8am-dose", status: "PENDING", dueDate: new Date(2026, 2, 10, 8, 0) }];
    const { dueToday, upcoming } = bucketInstances(instances, today, horizonExclusive);
    expect(dueToday.map((i) => i.id)).toEqual(["8am-dose"]);
    expect(upcoming).toEqual([]);
  });

  test("a timed dueDate earlier today, still not taken, is not treated as overdue", () => {
    const instances: I[] = [{ id: "8am-dose", status: "PENDING", dueDate: new Date(2026, 2, 10, 8, 0) }];
    const { overdue, dueToday } = bucketInstances(instances, today, horizonExclusive);
    expect(overdue).toEqual([]);
    expect(dueToday.map((i) => i.id)).toEqual(["8am-dose"]);
  });

  test("DONE instances still appear in dueToday but never in overdue/upcoming", () => {
    const instances: I[] = [
      { id: "done-today", status: "DONE", dueDate: new Date(2026, 2, 10, 20, 0) },
      { id: "done-yesterday", status: "DONE", dueDate: new Date(2026, 2, 9) },
    ];
    const { overdue, dueToday, upcoming } = bucketInstances(instances, today, horizonExclusive);
    expect(dueToday.map((i) => i.id)).toEqual(["done-today"]);
    expect(overdue).toEqual([]);
    expect(upcoming).toEqual([]);
  });

  test("upcoming includes the last horizon day but not the day after", () => {
    const instances: I[] = [
      { id: "last-day", status: "PENDING", dueDate: new Date(2026, 2, 13, 23, 0) },
      { id: "day-after", status: "PENDING", dueDate: new Date(2026, 2, 14) },
    ];
    const { upcoming } = bucketInstances(instances, today, horizonExclusive);
    expect(upcoming.map((i) => i.id)).toEqual(["last-day"]);
  });
});
