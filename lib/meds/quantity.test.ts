import { describe, expect, it } from "vitest";
import { doseConsumption, isLowStock } from "./quantity";

describe("doseConsumption", () => {
  it("is null when quantity tracking isn't configured (either field missing)", () => {
    expect(doseConsumption(null, 1)).toBeNull();
    expect(doseConsumption(10, null)).toBeNull();
    expect(doseConsumption(null, null)).toBeNull();
  });

  it("is the dose amount once both fields are set", () => {
    expect(doseConsumption(10, 1)).toBe(1);
  });

  it("supports fractional doses (half-tablet)", () => {
    expect(doseConsumption(5, 0.5)).toBe(0.5);
  });
});

describe("isLowStock", () => {
  it("is false when either value is missing", () => {
    expect(isLowStock(null, 2)).toBe(false);
    expect(isLowStock(5, null)).toBe(false);
  });

  it("is true at or below the threshold, false above it", () => {
    expect(isLowStock(2, 2)).toBe(true);
    expect(isLowStock(1, 2)).toBe(true);
    expect(isLowStock(3, 2)).toBe(false);
  });

  it("is true for a negative count — the honest signal the count is wrong, not clamped anywhere", () => {
    expect(isLowStock(-1, 0)).toBe(true);
  });
});
