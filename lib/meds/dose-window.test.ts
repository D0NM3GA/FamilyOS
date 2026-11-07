import { describe, expect, it } from "vitest";
import { canTakeYet } from "./dose-window";

describe("canTakeYet", () => {
  const now = new Date(2026, 10, 7, 9, 30);
  it("allows overdue doses and today's, even later today", () => {
    expect(canTakeYet(new Date(2026, 10, 6, 20, 0), now)).toBe(true);
    expect(canTakeYet(new Date(2026, 10, 7, 21, 0), now)).toBe(true);
  });
  it("refuses tomorrow's and later", () => {
    expect(canTakeYet(new Date(2026, 10, 8, 0, 0), now)).toBe(false);
    expect(canTakeYet(new Date(2026, 10, 9, 8, 0), now)).toBe(false);
  });
});
