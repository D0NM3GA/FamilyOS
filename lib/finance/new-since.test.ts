import { describe, expect, test } from "vitest";
import { filingFor, newSinceCutoff } from "./new-since";

describe("new since you last looked", () => {
  const now = new Date("2026-11-07T12:00:00Z");

  test("a first look counts the last 30 days as new; after that, since the last look", () => {
    expect(newSinceCutoff(null, now).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    const seen = new Date("2026-11-05T08:00:00Z");
    expect(newSinceCutoff(seen, now)).toBe(seen);
  });

  test("a change is the member's pick; an unchanged guess is confirmed; a rule's or a person's stays", () => {
    expect(filingFor({ categoryId: "a", categorySource: "RULE" }, "b")).toEqual({ categoryId: "b" });
    expect(filingFor({ categoryId: "a", categorySource: "AUTO" }, null)).toEqual({ categoryId: null });
    expect(filingFor({ categoryId: "a", categorySource: "AUTO" }, "a")).toEqual({ categoryId: "a" });
    expect(filingFor({ categoryId: "a", categorySource: "RULE" }, "a")).toBeNull();
    expect(filingFor({ categoryId: "a", categorySource: "PERSON" }, "a")).toBeNull();
    expect(filingFor({ categoryId: null, categorySource: null }, null)).toBeNull();
  });
});
