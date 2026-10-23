import { describe, expect, it } from "vitest";
import { formatQuantity, isSupplyLow, parseSupplyForm, parseSupplyUses, roundQuantity } from "./supplies";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("isSupplyLow", () => {
  it("is low at or below the threshold", () => {
    expect(isSupplyLow(2, 2)).toBe(true);
    expect(isSupplyLow(1.5, 2)).toBe(true);
    expect(isSupplyLow(2.001, 2)).toBe(false);
  });
  it("untracked stock or no threshold is never low", () => {
    expect(isSupplyLow(null, 2)).toBe(false);
    expect(isSupplyLow(0, null)).toBe(false);
  });
});

describe("display", () => {
  it("formats quantities with an optional unit", () => {
    expect(formatQuantity(5, "qt")).toBe("5 qt");
    expect(formatQuantity(0.1 + 0.2, null)).toBe("0.3");
  });
  it("rounds to thousandths", () => {
    expect(roundQuantity(12 - 0.1 * 3)).toBe(11.7);
  });
});

describe("parseSupplyForm", () => {
  it("blank optional fields become null", () => {
    const r = parseSupplyForm(form([["name", " Oil filter "], ["partNumber", ""], ["unit", ""], ["quantityOnHand", ""], ["lowThreshold", ""], ["notes", ""]]));
    expect(r).toEqual({ ok: true, fields: { name: "Oil filter", partNumber: null, unit: null, quantityOnHand: null, lowThreshold: null, notes: null } });
  });
  it("rejects a negative or non-numeric amount", () => {
    expect(parseSupplyForm(form([["name", "Oil"], ["quantityOnHand", "-1"]])).ok).toBe(false);
    expect(parseSupplyForm(form([["name", "Oil"], ["lowThreshold", "lots"]])).ok).toBe(false);
  });
  it("requires a name", () => {
    expect(parseSupplyForm(form([["name", "  "]])).ok).toBe(false);
  });
});

describe("parseSupplyUses", () => {
  it("pairs ids with amounts and skips the blank row", () => {
    const r = parseSupplyUses(form([["useSupplyId", "oil"], ["useQuantity", "5"], ["useSupplyId", ""], ["useQuantity", ""]]));
    expect(r).toEqual({ ok: true, uses: [{ supplyId: "oil", quantity: 5 }] });
  });
  it("a picked supply needs an amount above zero", () => {
    expect(parseSupplyUses(form([["useSupplyId", "oil"], ["useQuantity", "0"]])).ok).toBe(false);
    expect(parseSupplyUses(form([["useSupplyId", "oil"], ["useQuantity", ""]])).ok).toBe(false);
  });
  it("the same supply twice is an error", () => {
    const r = parseSupplyUses(form([["useSupplyId", "oil"], ["useQuantity", "5"], ["useSupplyId", "oil"], ["useQuantity", "1"]]));
    expect(r.ok).toBe(false);
  });
  it("no rows is an empty list", () => {
    expect(parseSupplyUses(form([]))).toEqual({ ok: true, uses: [] });
  });
});
