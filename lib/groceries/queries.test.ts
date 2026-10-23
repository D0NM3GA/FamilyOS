import { describe, expect, it } from "vitest";
import { groupBySection, groupItemsByStore, NO_STORE, pantrySearchTerms } from "./queries";

describe("pantrySearchTerms", () => {
  it("splits on spaces, lowercases and drops repeats", () => {
    expect(pantrySearchTerms("  Purina   DOG dog ")).toEqual(["purina", "dog"]);
  });

  it("is empty for nothing typed", () => {
    expect(pantrySearchTerms("")).toEqual([]);
    expect(pantrySearchTerms("   ")).toEqual([]);
    expect(pantrySearchTerms(null)).toEqual([]);
  });

  it("caps a pasted paragraph", () => {
    const terms = pantrySearchTerms(`${"x".repeat(100)} b c d e f g`);
    expect(terms).toHaveLength(5);
    expect(terms[0]).toHaveLength(40);
  });
});

describe("groupBySection", () => {
  const item = (id: string, section?: [string, string | null]) => ({
    id,
    product: { group: section ? { name: section[0], emoji: section[1] } : null },
  });

  it("keeps the walk order, puts each section's items together, and no section last", () => {
    const result = groupBySection([
      item("apples", ["Produce", "🥦"]),
      item("batteries"),
      item("bananas", ["Produce", "🥦"]),
      item("milk", ["Dairy", null]),
    ]);
    expect(result.map((g) => [g.section?.name ?? null, g.items.map((i) => i.id)])).toEqual([
      ["Produce", ["apples", "bananas"]],
      ["Dairy", ["milk"]],
      [null, ["batteries"]],
    ]);
    expect(result[0].section).toEqual({ name: "Produce", emoji: "🥦" });
  });

  it("is empty for an empty store", () => {
    expect(groupBySection([])).toEqual([]);
  });
});

describe("groupItemsByStore", () => {
  function item(id: string, name: string, opts: { done?: boolean; store?: string; section?: [number, string] } = {}) {
    return {
      id,
      done: opts.done ?? false,
      product: {
        name,
        defaultStore: opts.store ? { name: opts.store } : null,
        group: opts.section ? { sortOrder: opts.section[0], name: opts.section[1] } : null,
      },
    };
  }

  it("groups by store, Anywhere last", () => {
    const result = groupItemsByStore([item("1", "Milk"), item("2", "Dog food", { store: "Target" }), item("3", "Eggs", { store: "Aldi" })]);
    expect(result.map((g) => g.storeName)).toEqual(["Aldi", "Target", NO_STORE]);
  });

  it("sorts unchecked items before checked ones within a store", () => {
    const result = groupItemsByStore([item("done", "Aaa", { done: true }), item("pending", "Zzz")]);
    expect(result[0].items.map((i) => i.id)).toEqual(["pending", "done"]);
  });

  it("walks sections in their order, then by name; no section last", () => {
    const result = groupItemsByStore([
      item("pet", "Dog food", { section: [10, "Pet"] }),
      item("none", "Batteries"),
      item("milk", "Milk", { section: [1, "Dairy"] }),
      item("apples", "Apples", { section: [0, "Produce"] }),
      item("cheese", "Cheese", { section: [1, "Dairy"] }),
    ]);
    expect(result[0].items.map((i) => i.id)).toEqual(["apples", "cheese", "milk", "pet", "none"]);
  });
});
