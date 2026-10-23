import { describe, expect, it } from "vitest";
import { sheetReturnPath } from "./return-to";

describe("sheetReturnPath", () => {
  it("goes back to the list or the Pantry", () => {
    expect(sheetReturnPath("/groceries")).toBe("/groceries");
    expect(sheetReturnPath("/groceries/pantry")).toBe("/groceries/pantry");
  });

  it("keeps the Pantry's chip and search, and nothing else", () => {
    expect(sheetReturnPath("/groceries/pantry?filter=needs&q=dog%20food&item=old&evil=1")).toBe("/groceries/pantry?filter=needs&q=dog+food");
  });

  it("adds the item to reopen after a merge", () => {
    expect(sheetReturnPath("/groceries/pantry?q=milk", { item: "keep" })).toBe("/groceries/pantry?q=milk&item=keep");
    expect(sheetReturnPath("/groceries", { item: "a&b" })).toBe("/groceries?item=a%26b");
  });

  it("never leaves the groceries pages", () => {
    for (const raw of ["https://evil.example/groceries", "//evil.example/groceries", "/\\evil.example/groceries", "/settings", "/groceries/../settings", "", null, 42]) {
      const path = sheetReturnPath(raw);
      expect(path === "/groceries" || path.startsWith("/groceries?")).toBe(true);
    }
  });
});
