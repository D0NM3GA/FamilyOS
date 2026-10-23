import { describe, expect, it } from "vitest";
import { fitsPlace, isToy, itemDef, ITEMS, unlockedItems } from "./items";

describe("pet items", () => {
  it("only puts things where they belong", () => {
    expect(fitsPlace("ball", "out")).toBe(true);
    expect(fitsPlace("ball", "wall")).toBe(false);
    expect(fitsPlace("poster", "wall")).toBe(true);
    expect(fitsPlace("poster", "floor-left")).toBe(false);
    expect(fitsPlace("crown", "worn")).toBe(true);
    expect(fitsPlace("plant", "worn")).toBe(false);
    expect(fitsPlace("anything", null)).toBe(false);
    for (const item of ITEMS) expect(fitsPlace(item.id, null)).toBe(true);
  });

  it("gives every decoration somewhere to go", () => {
    for (const item of ITEMS.filter((i) => i.kind === "decor")) expect(item.slots?.length).toBeGreaterThan(0);
  });

  it("unlocks more as the pet grows and bonds, never a present-only keepsake", () => {
    expect(unlockedItems("egg", 0)).toEqual([]);
    expect(unlockedItems("baby", 0)).toEqual(["ball", "plant"]);
    const adult = unlockedItems("adult", 1000);
    expect(adult.length).toBeGreaterThan(unlockedItems("teen", 0).length);
    for (const id of adult) {
      expect(itemDef(id), id).toBeDefined();
      expect(itemDef(id)?.giftOnly, id).toBeFalsy();
    }
    expect(new Set(adult).size).toBe(adult.length);
  });

  it("knows its toys", () => {
    expect(isToy("kite")).toBe(true);
    expect(isToy("lamp")).toBe(false);
  });
});
