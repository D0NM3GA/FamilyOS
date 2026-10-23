import { describe, expect, it } from "vitest";
import {
  absorbedAfter,
  BUILT_IN_CATEGORY_KEYS,
  chargeCount,
  findCategoryByKey,
  guessCategory,
  isBuiltInCategory,
  isCategoryKey,
  keyNote,
  MAX_BUDGET_CENTS,
  mergedBudget,
  mergeEnvelope,
  newCategoryKey,
  randomKeySuffix,
  removalNote,
  STARTING_CATEGORIES,
  type Envelope,
} from "./categories";

describe("Phase 37: a jar's own categories", () => {
  it("keys an added category by its name plus a random suffix", () => {
    expect(newCategoryKey("Pets", "k3x9q2")).toBe("pets-k3x9q2");
    expect(newCategoryKey("  Kids' after-school  ", "abc123")).toBe("kids-after-school-abc123");
    expect(newCategoryKey("Café & crêpes", "abc123")).toBe("cafe-crepes-abc123");
    // Nothing usable in the name (all emoji, another script): a plain word stands in.
    expect(newCategoryKey("🐾🐾", "abc123")).toBe("category-abc123");
    expect(newCategoryKey("x".repeat(40), "abc123")).toBe(`${"x".repeat(24)}-abc123`);
    expect(newCategoryKey("a".repeat(23) + " b", "abc123")).toBe(`${"a".repeat(23)}-abc123`);
  });

  it("never makes a starting key, even from a starting name", () => {
    const starting = new Set(STARTING_CATEGORIES.map((c) => c.key));
    for (const c of STARTING_CATEGORIES) {
      const key = newCategoryKey(c.name);
      expect(starting.has(key)).toBe(false);
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{6}$/);
      // Guesses only ever name starting keys, so an added category is never guessed into.
      expect(guessCategory(key, -100)).not.toBe(key);
    }
  });

  it("makes a different suffix each time", () => {
    const suffixes = new Set(Array.from({ length: 50 }, randomKeySuffix));
    expect(suffixes.size).toBe(50);
    for (const s of suffixes) expect(s).toMatch(/^[a-z0-9]{6}$/);
  });

  it("keeps Other, Income and Transfers", () => {
    expect(BUILT_IN_CATEGORY_KEYS).toEqual(["other", "income", "transfers"]);
    expect(isBuiltInCategory("other")).toBe(true);
    expect(isBuiltInCategory("dining")).toBe(false);
    expect(isBuiltInCategory("pets-k3x9q2")).toBe(false);
    for (const key of BUILT_IN_CATEGORY_KEYS) expect(STARTING_CATEGORIES.some((c) => c.key === key)).toBe(true);
  });

  it("moves a removed category's budget onto the target's", () => {
    expect(mergedBudget(null, 20000)).toBe(20000); // the target had none: it takes this one
    expect(mergedBudget(30000, 20000)).toBe(50000); // both had one: they add up
    expect(mergedBudget(30000, null)).toBe(30000); // nothing to move
    expect(mergedBudget(null, null)).toBeNull();
    expect(mergedBudget(MAX_BUDGET_CENTS, MAX_BUDGET_CENTS)).toBe(MAX_BUDGET_CENTS);
  });

  it("finds a starting category by its own key, else the one it was removed into", () => {
    const cats = [
      { id: "o", key: "other", absorbedKeys: ["dining", "fun"] },
      { id: "s", key: "shopping", absorbedKeys: [] },
      { id: "f", key: "food-k3x9q2", absorbedKeys: ["groceries"] },
    ];
    expect(isCategoryKey(cats[0], "other")).toBe(true);
    expect(isCategoryKey(cats[0], "dining")).toBe(true);
    expect(isCategoryKey(cats[1], "dining")).toBe(false);
    expect(isCategoryKey(null, "dining")).toBe(false);
    expect(findCategoryByKey(cats, "groceries")?.id).toBe("f");
    expect(findCategoryByKey(cats, "shopping")?.id).toBe("s");
    expect(findCategoryByKey(cats, "travel")).toBeUndefined();
    // An own key always wins over one taken in (only an odd backup could have both).
    expect(findCategoryByKey([{ id: "x", key: "y", absorbedKeys: ["dining"] }, { id: "d", key: "dining", absorbedKeys: [] }], "dining")?.id).toBe("d");
  });

  it("hands every key a removed category had on to the target", () => {
    expect(absorbedAfter({ key: "other", absorbedKeys: ["fun"] }, { key: "dining", absorbedKeys: ["travel", "fun"] })).toEqual(["fun", "dining", "travel"]);
    // A family-added key isn't kept (nothing looks for it), so the list can't grow without end.
    expect(absorbedAfter({ key: "dining", absorbedKeys: [] }, { key: "food-k3x9q2", absorbedKeys: ["dining"] })).toEqual([]);
    expect(absorbedAfter({ key: "pets-a1b2c3", absorbedKeys: [] }, { key: "food-k3x9q2", absorbedKeys: ["groceries"] })).toEqual(["groceries"]);
  });

  const env = (name: string, over: Partial<Envelope> = {}): Envelope => ({ name, budgetCents: null, rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null, ...over });

  it("a target that isn't saving up takes over the removed one's saving up and goal", () => {
    const fun = env("Fun", { budgetCents: 5000, rollover: true, rolloverFrom: "2026-01", goalCents: 40000, goalMonth: "2027-06" });
    expect(mergeEnvelope(env("Other"), fun)).toEqual({ budgetCents: 5000, rollover: true, rolloverFrom: "2026-01", goalCents: 40000, goalMonth: "2027-06", tookSavings: true, droppedSavings: false });
    expect(removalNote(fun, env("Other"))).toBe(
      "Other takes Fun's $50.00 monthly budget. Other takes over Fun's saving up and goal. Other's saved-up amount is worked out again with the combined budget and both categories' charges.",
    );
  });

  it("a target that is saving up keeps its own, and the note says the removed one's goes away", () => {
    const fun = env("Fun", { budgetCents: 5000, rollover: true, rolloverFrom: "2026-01" });
    const shopping = env("Shopping", { budgetCents: 30000, rollover: true, rolloverFrom: "2026-03", goalCents: 90000, goalMonth: "2027-06" });
    expect(mergeEnvelope(shopping, fun)).toEqual({ budgetCents: 35000, rollover: true, rolloverFrom: "2026-03", goalCents: 90000, goalMonth: "2027-06", tookSavings: false, droppedSavings: true });
    expect(removalNote(fun, shopping)).toBe(
      "Shopping's monthly budget becomes $350.00, the two added up. Fun's saving up goes away; Shopping keeps its own. Shopping's saved-up amount is worked out again with the combined budget and both categories' charges.",
    );
  });

  it("says nothing when there's no budget or saving up to move", () => {
    expect(mergeEnvelope(env("Other", { budgetCents: 100 }), env("Fun"))).toMatchObject({ budgetCents: 100, rollover: false, tookSavings: false, droppedSavings: false });
    expect(removalNote(env("Fun"), env("Other", { budgetCents: 100 }))).toBeNull();
    expect(removalNote(env("Side gig"), env("Income"))).toBeNull();
  });

  it("says what the app did by key that the target takes over", () => {
    expect(keyNote({ name: "Groceries", key: "groceries", absorbedKeys: [] })).toBe(
      "Charges the app would have put in Groceries go to the one you pick. Grocery trips get matched to charges in the one you pick instead.",
    );
    expect(keyNote({ name: "Fixed costs", key: "fixed-costs-k3x9q2", absorbedKeys: ["subscriptions"] })).toBe(
      "Charges the app would have put in Fixed costs go to the one you pick. Bills & ahead treats regular charges in the one you pick as bills, as it did here.",
    );
    // Fun is never guessed, and a family's own category means nothing special.
    expect(keyNote({ name: "Fun", key: "fun", absorbedKeys: [] })).toBeNull();
    expect(keyNote({ name: "Pets", key: "pets-k3x9q2", absorbedKeys: [] })).toBeNull();
  });

  it("counts charges in words", () => {
    expect(chargeCount(0)).toBe("No charges");
    expect(chargeCount(1)).toBe("1 charge");
    expect(chargeCount(5)).toBe("5 charges");
  });
});
