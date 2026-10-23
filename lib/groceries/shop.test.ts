import { describe, expect, it } from "vitest";
import { ALL_STORES, acknowledge, enqueue, overlay, parseQueue, rankKidTiles, splitForShop, tripSavedHref, wirePayload, type ShopRow } from "./shop";

describe("tripSavedHref", () => {
  it("points the saved note at the trip that was just saved", () => {
    expect(tripSavedHref("ckabc123")).toBe("/groceries?trip=saved&purchase=ckabc123");
  });

  it("is just the list when nothing was saved", () => {
    expect(tripSavedHref(null)).toBe("/groceries");
  });
});

describe("check-off queue", () => {
  it("sends the last op per item and acknowledges exactly what it sent", () => {
    let q = enqueue([], "milk", true, "1");
    q = enqueue(q, "eggs", true, "2");
    q = enqueue(q, "milk", false, "3");
    const { ops, sentIds } = wirePayload(q);
    expect(ops).toEqual([
      { itemId: "milk", done: false },
      { itemId: "eggs", done: true },
    ]);
    // A tap while the send is in flight survives the acknowledgement.
    q = enqueue(q, "bread", true, "4");
    q = acknowledge(q, sentIds);
    expect(q).toEqual([{ id: "4", itemId: "bread", done: true, at: expect.any(Number) }]);
  });

  it("ids are unique, so two tabs' taps never collide", () => {
    const a = enqueue([], "milk", true);
    const b = enqueue([], "milk", true);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("overlays pending taps on the server's rows", () => {
    const rows = [
      { id: "milk", done: false },
      { id: "eggs", done: true },
    ];
    expect(overlay(rows, enqueue(enqueue([], "milk", true), "eggs", false))).toEqual([
      { id: "milk", done: true },
      { id: "eggs", done: false },
    ]);
    expect(overlay(rows, [])).toBe(rows);
  });

  it("reads stored queues defensively", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("not json")).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue('[{"id":"1","itemId":"x","done":true,"at":5},{"id":"2"},{"id":"3","itemId":"","done":true},null]', 10)).toEqual([
      { id: "1", itemId: "x", done: true, at: 5 },
    ]);
  });

  it("drops ticks older than 7 days, and dates ones stored before ticks kept a time", () => {
    const now = Date.UTC(2026, 9, 22);
    const day = 24 * 60 * 60 * 1000;
    const stored = JSON.stringify([
      { id: "old", itemId: "milk", done: true, at: now - 7 * day },
      { id: "recent", itemId: "eggs", done: true, at: now - 6 * day },
      { id: "legacy", itemId: "bread", done: false },
      { id: "junk", itemId: "jam", done: true, at: "yesterday" },
    ]);
    expect(parseQueue(stored, now)).toEqual([
      { id: "recent", itemId: "eggs", done: true, at: now - 6 * day },
      { id: "legacy", itemId: "bread", done: false, at: now },
      { id: "junk", itemId: "jam", done: true, at: now },
    ]);
    expect(enqueue([], "milk", true, "1", now)).toEqual([{ id: "1", itemId: "milk", done: true, at: now }]);
  });
});

describe("splitForShop", () => {
  const row = (id: string, store: string, sectionOrder: number, done = false): ShopRow => ({
    id,
    name: id,
    size: null,
    amount: "1",
    emoji: "🛒",
    storeName: store,
    sectionOrder,
    forName: null,
    done,
  });
  const rows = [row("milk", "Costco", 1), row("apples", "Costco", 0), row("dog food", "Target", 10), row("eggs", "Costco", 1, true)];

  it("walks the sections for one store and puts checked items in the cart", () => {
    const { toGet, inCart } = splitForShop(rows, "Costco");
    expect(toGet.map((r) => r.id)).toEqual(["apples", "milk"]);
    expect(inCart.map((r) => r.id)).toEqual(["eggs"]);
  });

  it("all stores", () => {
    expect(splitForShop(rows, ALL_STORES).toGet.map((r) => r.id)).toEqual(["apples", "milk", "dog food"]);
  });
});

describe("rankKidTiles", () => {
  it("the kid's own picks first, most often first, then the family's recent buys, nothing already listed", () => {
    expect(
      rankKidTiles({ kidPicks: ["goldfish", "juice", "goldfish"], recent: ["milk", "juice", "eggs"], onList: new Set(["eggs"]) }),
    ).toEqual(["goldfish", "juice", "milk"]);
  });

  it("stops at the limit", () => {
    expect(rankKidTiles({ kidPicks: [], recent: ["a", "b", "c"], onList: new Set(), limit: 2 })).toEqual(["a", "b"]);
  });
});
