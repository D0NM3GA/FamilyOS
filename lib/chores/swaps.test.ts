import { describe, expect, test } from "vitest";
import { stillAsAsked, swapStillGood } from "./swaps";

const today = new Date(2026, 10, 10);
const day = (d: number) => new Date(2026, 10, d);
const pending = (owner: string, d: number) => ({ status: "PENDING", assignedToId: owner, dueDate: day(d) });

describe("a swap still as asked", () => {
  test("pending, still theirs, on that day, not past", () => {
    expect(stillAsAsked(pending("ivy", 11), "ivy", day(11), today)).toBe(true);
    expect(stillAsAsked({ ...pending("ivy", 11), status: "DONE" }, "ivy", day(11), today)).toBe(false);
    expect(stillAsAsked(pending("max", 11), "ivy", day(11), today)).toBe(false);
    expect(stillAsAsked(pending("ivy", 12), "ivy", day(11), today)).toBe(false);
    expect(stillAsAsked(pending("ivy", 9), "ivy", day(9), today)).toBe(false);
    expect(stillAsAsked(null, "ivy", day(11), today)).toBe(false);
  });

  test("a chore given back must still be the other kid's too", () => {
    const s = { fromId: "ivy", toId: "max", dueDate: day(11), giveBackId: "g", giveBackDueDate: day(12) };
    expect(swapStillGood(s, pending("ivy", 11), pending("max", 12), today)).toBe(true);
    expect(swapStillGood(s, pending("ivy", 11), pending("ivy", 12), today)).toBe(false);
    expect(swapStillGood({ ...s, giveBackId: null, giveBackDueDate: null }, pending("ivy", 11), null, today)).toBe(true);
    // A give-back whose day has passed.
    expect(swapStillGood({ ...s, giveBackDueDate: day(9) }, pending("ivy", 11), pending("max", 9), today)).toBe(false);
  });
});
