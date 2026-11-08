import { describe, expect, it } from "vitest";
import { doseConsumption } from "./quantity";

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
