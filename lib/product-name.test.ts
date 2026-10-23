import { describe, expect, it } from "vitest";
import { productNameKey } from "./product-name";

describe("productNameKey", () => {
  it("case, spacing, punctuation and a plain plural don't make a new item", () => {
    expect(productNameKey("Eggs")).toBe(productNameKey("egg"));
    expect(productNameKey("  Paper   Towels! ")).toBe(productNameKey("paper towel"));
    expect(productNameKey("Crème fraîche")).toBe("creme fraiche");
  });

  it("keeps real differences", () => {
    expect(productNameKey("Milk 2%")).not.toBe(productNameKey("Milk"));
    expect(productNameKey("Glass cleaner")).toBe("glass cleaner");
    expect(productNameKey("Gas")).toBe("gas");
    expect(productNameKey("!!!")).toBe("");
  });
});
