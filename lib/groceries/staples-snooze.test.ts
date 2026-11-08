import { describe, expect, it } from "vitest";
import { stillSnoozed } from "./queries";
import { weekShopping } from "./meals";

/** Phase 69b: "Still have some" and "We always have it". */
const NOW = new Date(2026, 10, 8, 12);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("stillSnoozed", () => {
  it("hides for one usual gap from when it was said", () => {
    expect(stillSnoozed(daysAgo(3), { lastsDays: 7, daysSinceLast: 20 }, NOW)).toBe(true);
    expect(stillSnoozed(daysAgo(8), { lastsDays: 7, daysSinceLast: 20 }, NOW)).toBe(false);
    expect(stillSnoozed(null, { lastsDays: 7, daysSinceLast: 20 }, NOW)).toBe(false);
  });

  it("ends when it's bought after", () => {
    expect(stillSnoozed(daysAgo(5), { lastsDays: 14, daysSinceLast: 2 }, NOW)).toBe(false);
  });
});

describe("weekShopping skips what we always have", () => {
  it("adds salt only when it isn't a staple", () => {
    const ingredients = new Map([["tacos", [{ productId: "tortillas", quantity: 1 }, { productId: "salt", quantity: 1, alwaysHave: true }]]]);
    expect(weekShopping(["tacos"], ingredients, new Set())).toEqual([{ productId: "tortillas", quantity: 1 }]);
  });
});
