import { describe, expect, it } from "vitest";
import { cleanRestock, restockSchema } from "./restock";

describe("restock answers", () => {
  it("keeps positive amounts, one per item (the last wins), rounded to three places", () => {
    const m = cleanRestock([
      { itemId: "a", amount: 2 },
      { itemId: "a", amount: 3.33333 },
      { itemId: "b", amount: 5 },
      { itemId: "b", amount: 0 },
    ]);
    expect([...m]).toEqual([["a", 3.333]]);
  });

  it("refuses more than 10,000, negatives and non-numbers", () => {
    expect(restockSchema.safeParse([{ itemId: "a", amount: 10_001 }]).success).toBe(false);
    expect(restockSchema.safeParse([{ itemId: "a", amount: -1 }]).success).toBe(false);
    expect(restockSchema.safeParse([{ itemId: "a", amount: "5" }]).success).toBe(false);
    expect(restockSchema.safeParse([{ itemId: "a", amount: 10_000 }]).success).toBe(true);
  });
});
