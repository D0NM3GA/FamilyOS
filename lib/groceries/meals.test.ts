import { describe, expect, test } from "vitest";
import { ingredientLines, mealWeekStart, parseIngredients, weekFromParam, weekShopping } from "./meals";

describe("meal plan (Phase 65d)", () => {
  test("ingredient lines: a number first is how many; same items fold; blanks dropped", () => {
    expect(parseIngredients("Tortillas\n2 Tomatoes\n\n1.5 lb beef\n tomatoes \n3 x Limes\n2x Onions")).toEqual({
      ok: true,
      items: [
        { name: "Tortillas", quantity: 1 },
        { name: "Tomatoes", quantity: 3 },
        // A weight is a recipe amount: one package.
        { name: "beef", quantity: 1 },
        { name: "Limes", quantity: 3 },
        { name: "Onions", quantity: 2 },
      ],
    });
    // A name that starts with a digit stays whole, and survives a re-save.
    const odd = parseIngredients("2% milk\n7-Up\n1/2 onion\n12 oz pasta\n1 x 100 calorie packs");
    expect(odd).toEqual({
      ok: true,
      items: [
        { name: "2% milk", quantity: 1 },
        { name: "7-Up", quantity: 1 },
        { name: "1/2 onion", quantity: 1 },
        { name: "pasta", quantity: 1 },
        { name: "100 calorie packs", quantity: 1 },
      ],
    });
    if (!odd.ok) throw new Error("expected ok");
    expect(parseIngredients(ingredientLines(odd.items))).toEqual(odd);
    expect(parseIngredients(Array.from({ length: 41 }, (_, i) => `Item ${i}`).join("\n"))).toEqual({ ok: false, error: "At most 40 ingredients." });
    expect(parseIngredients("0 Eggs")).toEqual({ ok: false, error: "Check the amount for Eggs." });
    expect(ingredientLines([{ name: "Tortillas", quantity: 1 }, { name: "Tomatoes", quantity: 2 }])).toBe("Tortillas\n2 x Tomatoes");
  });

  test("weeks run Sunday to Saturday; a bad or far-off ?week= is this week", () => {
    const wed = new Date(2026, 10, 11);
    expect(mealWeekStart(wed)).toEqual(new Date(2026, 10, 8));
    expect(weekFromParam("2026-11-14", wed)).toEqual(new Date(2026, 10, 8));
    expect(weekFromParam("2026-11-15", wed)).toEqual(new Date(2026, 10, 15));
    expect(weekFromParam("nope", wed)).toEqual(new Date(2026, 10, 8));
    expect(weekFromParam("2026-02-31", wed)).toEqual(new Date(2026, 10, 8));
    expect(weekFromParam("2199-01-01", wed)).toEqual(new Date(2026, 10, 8));
  });

  test("the week's shopping: each item once, summed, not what's on the list", () => {
    const ingredients = new Map([
      ["tacos", [{ productId: "tortillas", quantity: 1 }, { productId: "beef", quantity: 1 }]],
      ["chili", [{ productId: "beef", quantity: 2 }, { productId: "beans", quantity: 1 }]],
    ]);
    expect(weekShopping(["tacos", null, "chili", "tacos"], ingredients, new Set(["beans"]))).toEqual([
      { productId: "tortillas", quantity: 2 },
      { productId: "beef", quantity: 4 },
    ]);
  });
});
