import { describe, expect, it } from "vitest";
import { goodUntilDefault } from "@/app/(app)/vehicles/card-item";

/** Phase 69b: the Renewed form's Good until starts at the next due day after today. */
describe("goodUntilDefault", () => {
  const today = new Date(2026, 10, 8);
  it("a cycle on from the due day, moved on while it isn't after today", () => {
    expect(goodUntilDefault(new Date(2026, 11, 1), 12, today)).toBe("2027-12-01");
    // Lapsed two years: lands on the next one after today.
    expect(goodUntilDefault(new Date(2024, 2, 15), 12, today)).toBe("2027-03-15");
    expect(goodUntilDefault(null, 12, today)).toBe("");
    expect(goodUntilDefault(new Date(2026, 11, 1), null, today)).toBe("");
  });
});
