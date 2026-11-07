import { describe, expect, test } from "vitest";
import { moveChoices } from "./move";

const now = new Date(2026, 10, 7, 15);
const day = (d: number) => new Date(2026, 10, d);
const chore = (over: Partial<Parameters<typeof moveChoices>[0]> = {}) => ({
  id: "i1",
  definitionId: "d1",
  dueDate: day(7),
  status: "PENDING",
  movedFrom: null as Date | null,
  frequencyType: "WEEKLY",
  ...over,
});
const none = new Set<string>();

describe("moveChoices (Phase 59.2b)", () => {
  test("today's can go to tomorrow; an overdue one to today or tomorrow", () => {
    expect(moveChoices(chore(), none, now)).toEqual({ tomorrow: true, today: false, back: false });
    expect(moveChoices(chore({ dueDate: day(5) }), none, now)).toEqual({ tomorrow: true, today: true, back: false });
    expect(moveChoices(chore({ dueDate: day(9) }), none, now)).toEqual({ tomorrow: false, today: false, back: false });
  });
  test("never a daily chore, or one that's done", () => {
    expect(moveChoices(chore({ frequencyType: "DAILY" }), none, now)).toEqual({ tomorrow: false, today: false, back: false });
    expect(moveChoices(chore({ status: "DONE" }), none, now).tomorrow).toBe(false);
  });
  test("not onto a day that chore already has", () => {
    const taken = new Set([`d1|${day(8).getTime()}`]);
    expect(moveChoices(chore(), taken, now).tomorrow).toBe(false);
  });
  test("a moved one can go back while its day is free", () => {
    expect(moveChoices(chore({ dueDate: day(8), movedFrom: day(7) }), none, now).back).toBe(true);
    expect(moveChoices(chore({ dueDate: day(8), movedFrom: day(7) }), new Set([`d1|${day(7).getTime()}`]), now).back).toBe(false);
  });
  test("not back to a day that's fallen out of the overdue window", () => {
    expect(moveChoices(chore({ dueDate: day(8), movedFrom: day(1) }), none, now).back).toBe(true);
    expect(moveChoices(chore({ dueDate: day(8), movedFrom: new Date(2026, 9, 30) }), none, now).back).toBe(false);
  });
  test("back even for a chore that became daily after it moved", () => {
    expect(moveChoices(chore({ dueDate: day(8), movedFrom: day(7), frequencyType: "DAILY" }), none, now).back).toBe(true);
  });
});
