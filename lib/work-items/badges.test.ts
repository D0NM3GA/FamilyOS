import { describe, expect, it } from "vitest";
import { badgeWords } from "./badges";

describe("badgeWords (Phase 59.4b)", () => {
  it("says the most urgent first, and nothing when all's well", () => {
    expect(badgeWords({ overdue: 2, missing: 1, nextTest: new Date(2026, 10, 12) })).toEqual(["2 overdue", "1 missing", "Test Thu"]);
    expect(badgeWords({ overdue: 0, missing: 0, nextTest: null })).toEqual([]);
  });
});
