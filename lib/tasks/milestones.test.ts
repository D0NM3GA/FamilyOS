import { describe, expect, it } from "vitest";
import { milestoneCrossed, nextMilestone, MILESTONES } from "./milestones";

describe("milestoneCrossed", () => {
  it("returns the milestone when a completion crosses it", () => {
    expect(milestoneCrossed(9, 10)).toBe(10);
    expect(milestoneCrossed(24, 25)).toBe(25);
    expect(milestoneCrossed(499, 500)).toBe(500);
  });

  it("returns null when no milestone is crossed", () => {
    expect(milestoneCrossed(10, 11)).toBeNull();
    expect(milestoneCrossed(0, 1)).toBeNull();
    expect(milestoneCrossed(500, 501)).toBeNull(); // past the last milestone entirely
  });

  it("returns the milestone actually crossed when starting already past an earlier one", () => {
    // Defensive case — completions increment by one in practice, so `before` skipping an
    // entire milestone can't really happen, but the function shouldn't silently misreport
    // if it ever does (e.g. a manual ledger correction).
    expect(milestoneCrossed(24, 26)).toBe(25);
  });

  it("does not re-fire for a value already past the milestone on both sides", () => {
    expect(milestoneCrossed(15, 16)).toBeNull();
  });
});

describe("nextMilestone", () => {
  it("returns the next milestone still ahead", () => {
    expect(nextMilestone(0)).toBe(10);
    expect(nextMilestone(10)).toBe(25);
    expect(nextMilestone(30)).toBe(50);
  });

  it("returns null once past the last milestone", () => {
    expect(nextMilestone(500)).toBeNull();
    expect(nextMilestone(1000)).toBeNull();
  });

  it("MILESTONES is sorted ascending (both functions rely on this)", () => {
    const sorted = [...MILESTONES].sort((a, b) => a - b);
    expect([...MILESTONES]).toEqual(sorted);
  });
});
