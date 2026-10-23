import { describe, expect, it } from "vitest";
import { amountLabel, describeSize, needsSize, parseOffQuantity } from "./size";

const size = (sizeAmount: number | null, sizeUnit: string | null, container: string | null) => ({ sizeAmount, sizeUnit, container });

describe("describeSize", () => {
  it("reads as a phrase", () => {
    expect(describeSize(size(31.1, "lb", "bag"))).toBe("31.1 lb bag");
    expect(describeSize(size(1, "gal", "jug"))).toBe("1 gal jug");
    expect(describeSize(size(400, "g", null))).toBe("400 g");
  });

  it("counted units read as a pack", () => {
    expect(describeSize(size(12, "rolls", "pack"))).toBe("12-roll pack");
    expect(describeSize(size(100, "count", "box"))).toBe("100-count box");
    expect(describeSize(size(24, "count", null))).toBe("24 count");
  });

  it("container alone, or nothing", () => {
    expect(describeSize(size(null, null, "bunch"))).toBe("by the bunch");
    expect(describeSize(size(null, null, "carton"))).toBe("carton");
    expect(describeSize(size(null, "lb", null))).toBeNull();
    expect(describeSize(size(0, "lb", "bag"))).toBe("bag");
    expect(needsSize(size(null, null, null))).toBe(true);
  });
});

describe("amountLabel", () => {
  it("counts containers", () => {
    expect(amountLabel(1, "bag")).toBe("1 bag");
    expect(amountLabel(2, "bag")).toBe("2 bags");
    expect(amountLabel(2, "box")).toBe("2 boxes");
    expect(amountLabel(2, "loaf")).toBe("2 loaves");
    expect(amountLabel(3, null)).toBe("3");
    expect(amountLabel(1.5, "each")).toBe("1.5");
  });
});

describe("parseOffQuantity", () => {
  it("reads what's printed on the pack", () => {
    expect(parseOffQuantity("31.1 lb")).toEqual({ sizeAmount: 31.1, sizeUnit: "lb" });
    expect(parseOffQuantity("400 g ℮")).toEqual({ sizeAmount: 400, sizeUnit: "g" });
    expect(parseOffQuantity("400 g e")).toEqual({ sizeAmount: 400, sizeUnit: "g" });
    expect(parseOffQuantity("16.9 fl oz (500 ml)")).toEqual({ sizeAmount: 16.9, sizeUnit: "fl oz" });
    expect(parseOffQuantity("1,5 L")).toEqual({ sizeAmount: 1.5, sizeUnit: "L" });
    expect(parseOffQuantity("12 Rolls")).toEqual({ sizeAmount: 12, sizeUnit: "rolls" });
    expect(parseOffQuantity("6 x 330 ml")).toEqual({ sizeAmount: 6, sizeUnit: "count" });
  });

  it("gives up on anything it doesn't know", () => {
    expect(parseOffQuantity("family size")).toBeNull();
    expect(parseOffQuantity("3 bananas")).toBeNull();
    expect(parseOffQuantity(null)).toBeNull();
  });
});
