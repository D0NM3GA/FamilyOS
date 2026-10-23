import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveReceiptPrices } from "./receipts";
import { getTrips } from "./trips";

/**
 * Past trips against a real database: `npm run test:db`. Newest first, a page at a time with
 * nothing skipped or repeated (even two trips saved in the same instant), only this family's,
 * and a trip knows when a receipt's prices were saved for it.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("past trips (database)", () => {
  const ids = { h: "", other: "", mom: "", kid: "", milk: "", eggs: "", oldest: "", twinA: "", twinB: "", middle: "", newest: "", theirs: "" };
  const day = (d: number, h = 12) => new Date(2026, 8, d, h, 0, 0, 0);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-trips-${Date.now()}` } });
    const other = await prisma.household.create({ data: { name: `e2e-trips-other-${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const dairy = await prisma.productGroup.create({ data: { householdId: h.id, name: "Dairy", emoji: "🥛" } });
    const milk = await prisma.product.create({ data: { householdId: h.id, name: "Milk", nameKey: "milk", container: "jug", groupId: dairy.id } });
    const eggs = await prisma.product.create({ data: { householdId: h.id, name: "Eggs", nameKey: "egg" } });

    const trip = (at: Date, items: { productId?: string; description: string; quantity?: number; requestedById?: string }[]) =>
      prisma.purchase.create({ data: { householdId: h.id, purchasedById: mom.id, purchasedAt: at, items: { create: items } } });
    const oldest = await trip(day(1), [{ productId: eggs.id, description: "Eggs" }]);
    // Two trips in the same instant: paging must still show each exactly once.
    const twinA = await trip(day(5), [{ description: "Batteries" }]);
    const twinB = await trip(day(5), [{ description: "Tape" }]);
    const middle = await trip(day(10), [
      { productId: milk.id, description: "Milk", quantity: 2, requestedById: kid.id },
      { productId: eggs.id, description: "Eggs" },
    ]);
    const newest = await trip(day(20), [{ productId: eggs.id, description: "Eggs" }]);
    const theirs = await prisma.purchase.create({ data: { householdId: other.id, purchasedAt: day(15), items: { create: [{ description: "Their milk" }] } } });

    Object.assign(ids, {
      h: h.id, other: other.id, mom: mom.id, kid: kid.id, milk: milk.id, eggs: eggs.id,
      oldest: oldest.id, twinA: twinA.id, twinB: twinB.id, middle: middle.id, newest: newest.id, theirs: theirs.id,
    });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("newest first, only this family's, with who shopped and what came home", async () => {
    const { trips, olderCursor } = await getTrips(ids.h, { withPrices: false });
    const order = trips.map((t) => t.id);
    expect(order).toHaveLength(5);
    expect([order[0], order[1], order[4]]).toEqual([ids.newest, ids.middle, ids.oldest]);
    expect(new Set(order.slice(2, 4))).toEqual(new Set([ids.twinA, ids.twinB]));
    expect(olderCursor).toBeNull();

    const middle = trips[1];
    expect(middle.shopperName).toBe("Mom");
    // Grown-up details aren't even fetched for a kid's view.
    expect(middle.pricesSaved).toBeNull();
    expect(middle.items).toEqual([
      { id: expect.any(String), name: "Eggs", amount: "1", emoji: "🛒", forName: null },
      { id: expect.any(String), name: "Milk", amount: "2 jugs", emoji: "🥛", forName: "Ivy" },
    ]);
  });

  test("a page at a time, nothing skipped or repeated", async () => {
    const all = (await getTrips(ids.h, { withPrices: false })).trips.map((t) => t.id);
    const walked: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await getTrips(ids.h, { before, withPrices: false, limit: 2 });
      walked.push(...result.trips.map((t) => t.id));
      if (!result.olderCursor) break;
      before = result.olderCursor;
    }
    expect(walked).toEqual(all);
  });

  test("another family's trip id as the cursor just starts from the newest", async () => {
    const { trips } = await getTrips(ids.h, { before: ids.theirs, withPrices: false, limit: 1 });
    expect(trips.map((t) => t.id)).toEqual([ids.newest]);
    expect((await getTrips(ids.other, { before: ids.middle, withPrices: false })).trips.map((t) => t.id)).toEqual([ids.theirs]);
  });

  test("a trip knows when its receipt's prices were saved", async () => {
    const line = (productId: string, totalCents: number) => ({
      key: `line ${totalCents}`, productId, quantity: null, unitCents: null, totalCents, initialProductId: null, initialHow: "none" as const,
    });
    expect(await saveReceiptPrices(ids.h, { purchaseId: ids.middle, storeId: null, date: null, lines: [line(ids.milk, 389), line(ids.eggs, 299)] })).toBe(2);
    // A receipt that wasn't for a trip counts for none of them.
    await saveReceiptPrices(ids.h, { purchaseId: null, storeId: null, date: "2026-09-20", lines: [line(ids.eggs, 310)] });

    const { trips } = await getTrips(ids.h, { withPrices: true });
    const saved = Object.fromEntries(trips.map((t) => [t.id, t.pricesSaved]));
    expect(saved[ids.middle]).toBe(2);
    expect(saved[ids.newest]).toBe(0);
    expect(saved[ids.oldest]).toBe(0);
  });
});
