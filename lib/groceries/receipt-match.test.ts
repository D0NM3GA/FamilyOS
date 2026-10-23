import { describe, expect, it } from "vitest";
import { isNonItem, matchReceipt, receiptTextKey, similarity, unitCentsFor } from "./receipt-match";

const line = (text: string, totalCents: number | null = 100, quantity: number | null = null, unitCents: number | null = null) => ({
  text,
  totalCents,
  quantity,
  unitCents,
});
const item = (id: string, name: string, brand: string | null = null) => ({ id, name, brand });

describe("receiptTextKey", () => {
  it("drops prices and item codes, keeps the words", () => {
    expect(receiptTextKey("PURINA DOG FD 31.1LB  $54.99")).toBe("purina dog fd 31 1lb");
    expect(receiptTextKey("012345678905 BANANAS")).toBe("bananas");
    expect(receiptTextKey("Bananas")).toBe(receiptTextKey("BANANAS"));
  });
});

describe("similarity", () => {
  it("handles receipt abbreviations and brands", () => {
    expect(similarity("DOG FD", item("d", "Dog food"))).toBeGreaterThanOrEqual(0.7);
    expect(similarity("PURINA DOG FD 31.1LB", item("d", "Dog food", "Purina Pro Plan"))).toBeGreaterThan(0.6);
    expect(similarity("GLDFSH CRCKRS", item("g", "Goldfish crackers"))).toBeGreaterThanOrEqual(0.7);
    expect(similarity("BANANAS", item("b", "Bananas"))).toBe(1);
  });

  it("doesn't match on a brand alone or on nothing", () => {
    expect(similarity("PURINA CAT CHOW", item("d", "Dog food", "Purina"))).toBe(0);
    expect(similarity("MILK", item("e", "Eggs"))).toBe(0);
  });
});

describe("isNonItem", () => {
  it("skips totals, tax, coupons and lines without a price", () => {
    for (const t of ["SUBTOTAL", "TAX 8.25%", "BAG FEE", "COUPON DOG FD"]) expect(isNonItem(line(t))).toBe(true);
    expect(isNonItem(line("DOG FD", -500))).toBe(true);
    expect(isNonItem(line("DOG FD", null))).toBe(true);
    expect(isNonItem(line("DOG FD", 5499))).toBe(false);
  });
});

describe("matchReceipt", () => {
  const pantry = [item("dog", "Dog food", "Purina"), item("ban", "Bananas"), item("gold", "Goldfish crackers"), item("milk", "Milk")];

  it("learned aliases win, trip items are suggested once each, strong ones pre-selected", () => {
    const lines = [line("KS DOG FD 31LB", 5499), line("BANANAS", 138), line("BANANAS ORG", 200), line("TAX", 50), line("GLDFSH", 250)];
    const result = matchReceipt({
      lines,
      aliases: new Map([[receiptTextKey("KS DOG FD 31LB"), "dog"]]),
      trip: pantry.slice(0, 3),
      pantry,
    });
    expect(result.map((r) => [r.productId, r.how, r.preselect, r.skip])).toEqual([
      ["dog", "learned", true, false],
      ["ban", "suggested", true, false],
      [null, "none", false, false],
      [null, "none", false, true],
      ["gold", "suggested", expect.any(Boolean), false],
    ]);
  });

  it("an alias for an item that's gone is ignored", () => {
    const [r] = matchReceipt({ lines: [line("MYSTERY")], aliases: new Map([["mystery", "deleted"]]), trip: [], pantry });
    expect(r.productId).toBeNull();
  });

  it("with no trip, the whole Pantry at a stricter bar", () => {
    const [weak, strong] = matchReceipt({ lines: [line("DOG TREATS"), line("MILK")], aliases: new Map(), trip: [], pantry });
    expect(weak.productId).toBeNull();
    expect(strong).toMatchObject({ productId: "milk", preselect: true });
  });
});

describe("unitCentsFor", () => {
  it("per one when it can be known, never per pound", () => {
    expect(unitCentsFor({ quantity: null, unitCents: null, totalCents: 5499 })).toBe(5499);
    expect(unitCentsFor({ quantity: 2, unitCents: null, totalCents: 799 })).toBe(400);
    expect(unitCentsFor({ quantity: 2, unitCents: 399, totalCents: 798 })).toBe(399);
    expect(unitCentsFor({ quantity: 2.34, unitCents: 199, totalCents: 466 })).toBeNull();
  });
});
