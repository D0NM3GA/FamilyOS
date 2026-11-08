import { describe, expect, it } from "vitest";
import { scheduleChanged } from "./edit";

const base = {
  frequencyType: "DAYS_OF_WEEK",
  interval: null,
  daysOfWeek: [2],
  startDate: new Date(2026, 9, 1),
  assignmentStrategy: "ROUND_ROBIN",
  assigneeIds: ["ivy", "max"],
};

describe("scheduleChanged (Phase 66a)", () => {
  it("is false for the same schedule and people, in any order", () => {
    expect(scheduleChanged(base, { ...base, assigneeIds: ["max", "ivy"], daysOfWeek: [2] })).toBe(false);
  });

  it("is true when the days, rotation, start or people change", () => {
    expect(scheduleChanged(base, { ...base, daysOfWeek: [4] })).toBe(true);
    expect(scheduleChanged(base, { ...base, assignmentStrategy: "FIXED" })).toBe(true);
    expect(scheduleChanged(base, { ...base, startDate: new Date(2026, 9, 8) })).toBe(true);
    expect(scheduleChanged(base, { ...base, assigneeIds: ["ivy"] })).toBe(true);
    expect(scheduleChanged(base, { ...base, frequencyType: "WEEKLY", interval: 1 })).toBe(true);
  });

  it("treats a missing interval and null alike", () => {
    expect(scheduleChanged(base, { ...base, interval: undefined as unknown as null })).toBe(false);
  });
});
