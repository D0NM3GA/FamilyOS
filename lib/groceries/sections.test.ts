import { describe, expect, it } from "vitest";
import { guessSection, itemCount, moveSection, STARTING_SECTIONS } from "./sections";

describe("guessSection", () => {
  it.each([
    ["Dog food", "pet"],
    ["Dog treats", "pet"],
    ["Milk", "dairy"],
    ["Eggs", "dairy"],
    ["Ice cream", "frozen"],
    ["Peanut butter", "pantry"],
    ["Paper towels", "household"],
    ["Goldfish crackers", "snacks"],
    ["Bananas", "produce"],
    ["Apples", "produce"],
    ["Diapers", "baby"],
    ["Orange juice", "drinks"],
    ["Shampoo", "bath"],
  ])("%s → %s", (name, section) => {
    expect(guessSection(name)).toBe(section);
  });

  it("matches whole words only", () => {
    expect(guessSection("Grapefruit")).toBeNull();
    expect(guessSection("Batteries AA")).toBe("household");
    expect(guessSection("Mystery thing")).toBeNull();
  });

  it("only ever suggests a starting section, by its key (Phase 37: renames don't matter)", () => {
    const keys = new Set<string>(STARTING_SECTIONS.map((s) => s.key));
    for (const n of ["Dog food", "Milk", "Bread", "Steak", "Soap"]) expect(keys.has(guessSection(n)!)).toBe(true);
  });

  it("gives every starting section its own key", () => {
    expect(new Set(STARTING_SECTIONS.map((s) => s.key)).size).toBe(STARTING_SECTIONS.length);
    expect(new Set(STARTING_SECTIONS.map((s) => s.name.toLowerCase())).size).toBe(STARTING_SECTIONS.length);
  });
});

describe("Phase 37: moving a section", () => {
  const order = ["produce", "dairy", "meat"];

  it("swaps with its neighbor", () => {
    expect(moveSection(order, "dairy", "up")).toEqual(["dairy", "produce", "meat"]);
    expect(moveSection(order, "dairy", "down")).toEqual(["produce", "meat", "dairy"]);
    expect(order).toEqual(["produce", "dairy", "meat"]);
  });

  it("can't go past either end, or move what isn't there", () => {
    expect(moveSection(order, "produce", "up")).toBeNull();
    expect(moveSection(order, "meat", "down")).toBeNull();
    expect(moveSection(order, "frozen", "up")).toBeNull();
  });

  it("counts items in words", () => {
    expect(itemCount(0)).toBe("No items");
    expect(itemCount(1)).toBe("1 item");
    expect(itemCount(18)).toBe("18 items");
  });
});
