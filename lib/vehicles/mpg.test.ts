import { describe, expect, test } from "vitest";
import { computeMpg, type FuelEntry } from "./mpg";

function fill(id: string, mileage: number, gallons: number, overrides: Partial<FuelEntry> = {}): FuelEntry {
  return { id, mileage, gallons, fullTank: true, missedPrevious: false, ...overrides };
}

describe("computeMpg", () => {
  test("first fill is only an anchor; each later full fill gets miles / gallons", () => {
    const result = computeMpg([fill("a", 10_000, 12), fill("b", 10_300, 10), fill("c", 10_600, 12)]);
    expect(result.perEntry.get("a")).toEqual({ mpg: null, anomaly: false });
    expect(result.perEntry.get("b")).toEqual({ mpg: 30, anomaly: false });
    expect(result.perEntry.get("c")).toEqual({ mpg: 25, anomaly: false });
    expect(result.averageMpg).toBeCloseTo(600 / 22);
  });

  test("partial fills between anchors roll their gallons into the next full fill", () => {
    const result = computeMpg([
      fill("a", 10_000, 12),
      fill("p", 10_150, 4, { fullTank: false }),
      fill("b", 10_400, 6),
    ]);
    expect(result.perEntry.get("p")).toEqual({ mpg: null, anomaly: false });
    expect(result.perEntry.get("b")?.mpg).toBe(40); // 400 mi / (4 + 6) gal
  });

  test("a missedPrevious fill gets no MPG, and the next full fill is computed from it", () => {
    const result = computeMpg([
      fill("a", 10_000, 12),
      fill("m", 11_000, 12, { missedPrevious: true }),
      fill("b", 11_300, 10),
    ]);
    expect(result.perEntry.get("m")).toEqual({ mpg: null, anomaly: false });
    expect(result.perEntry.get("b")?.mpg).toBe(30); // from m's 11,000, not a's 10,000
    expect(result.totalMiles).toBe(300);
  });

  test("a missedPrevious partial fill drops the anchor entirely until the next full fill", () => {
    const result = computeMpg([
      fill("a", 10_000, 12),
      fill("m", 10_500, 5, { missedPrevious: true, fullTank: false }),
      fill("b", 10_800, 10),
      fill("c", 11_100, 10),
    ]);
    expect(result.perEntry.get("b")?.mpg).toBeNull();
    expect(result.perEntry.get("c")?.mpg).toBe(30);
  });

  test("sorts by mileage, not input order", () => {
    const result = computeMpg([fill("b", 10_300, 10), fill("a", 10_000, 12)]);
    expect(result.perEntry.get("b")?.mpg).toBe(30);
  });

  test("a duplicate mileage is flagged as an anomaly instead of dividing by zero miles", () => {
    const result = computeMpg([fill("a", 10_000, 12), fill("dup", 10_000, 3), fill("b", 10_300, 10)]);
    expect(result.perEntry.get("dup")).toEqual({ mpg: null, anomaly: true });
    expect(result.perEntry.get("b")?.mpg).toBe(30);
  });

  test("no computable segment -> null average", () => {
    expect(computeMpg([]).averageMpg).toBeNull();
    expect(computeMpg([fill("a", 10_000, 12)]).averageMpg).toBeNull();
  });
});
