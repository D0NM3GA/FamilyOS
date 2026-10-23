import { describe, expect, test } from "vitest";
import { describeRecurrence } from "./format";

const rule = (frequencyType: Parameters<typeof describeRecurrence>[0]["frequencyType"], interval: number | null = null, daysOfWeek: number[] = []) => ({
  frequencyType,
  interval,
  daysOfWeek,
});

describe("describeRecurrence", () => {
  test.each([
    [rule("ONCE"), "Once"],
    [rule("DAILY"), "Daily"],
    [rule("WEEKLY"), "Weekly"],
    [rule("WEEKLY", 1), "Weekly"],
    [rule("WEEKLY", 2), "Every 2 weeks"],
    [rule("MONTHLY", 3), "Every 3 months"],
    [rule("INTERVAL_DAYS", 3), "Every 3 days"],
    [rule("INTERVAL_DAYS", 1), "Daily"],
    [rule("DAYS_OF_WEEK", null, [5, 1, 3]), "Mon, Wed, Fri"],
    [rule("DAYS_OF_WEEK", null, [0, 1, 2, 3, 4, 5, 6]), "Daily"],
    [rule("DAYS_OF_WEEK", null, []), "Specific days"],
  ])("%o -> %s", (r, expected) => {
    expect(describeRecurrence(r)).toBe(expected);
  });
});
