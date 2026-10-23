import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { findOrCreateProductByName, getOrCreateActiveList, requestItemByName } from "@/lib/shopping-list";
import { mergeProducts } from "./merge";

/**
 * Phase 22's Pantry against a real database: `npm run test:db`. Typed names become one
 * item per household (race-safe), other apps' requests dedupe, and "Same as…" merges move
 * list rows and history without losing a barcode to the unique index.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("Pantry items (database)", () => {
  const ids = { h: "", other: "", mom: "", kid: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-pantry-${Date.now()}` } });
    const other = await prisma.household.create({ data: { name: `e2e-pantry-other-${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, kid: kid.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("typed names find the same item, even when added at the same moment", async () => {
    const results = await Promise.all(["Dog food", "dog food", "DOG FOODS", "Dog  food!"].map((n) => findOrCreateProductByName(ids.h, n)));
    expect(new Set(results.map((r) => r.product.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    // Another family's "Dog food" is its own item.
    const theirs = await findOrCreateProductByName(ids.other, "Dog food");
    expect(theirs.product.id).not.toBe(results[0].product.id);
  });

  test("other apps' requests land on the Pantry item once, checked off or not", async () => {
    expect(await requestItemByName({ householdId: ids.h, name: "Vitamin D", addedById: ids.mom, requestedById: ids.kid })).toEqual({ created: true });
    const list = await getOrCreateActiveList(ids.h);
    await prisma.shoppingListItem.updateMany({ where: { listId: list.id }, data: { done: true } });
    expect(await requestItemByName({ householdId: ids.h, name: "vitamin d", addedById: ids.mom })).toEqual({ created: false });
    const rows = await prisma.shoppingListItem.findMany({ where: { listId: list.id, product: { name: "Vitamin D" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].requestedById).toBe(ids.kid);
  });

  test("Same as… combines list rows and history, keeps a barcode, and stays in the family", async () => {
    const list = await getOrCreateActiveList(ids.h);
    const keep = await prisma.product.create({ data: { householdId: ids.h, name: "Milk", nameKey: "milk", sizeAmount: 1, sizeUnit: "gal", container: "jug" } });
    const dupe = await prisma.product.create({
      data: { householdId: ids.h, name: "Milk 2%", nameKey: "milk 2%", barcode: `e2e-${Date.now()}`, brand: "Kemps", sizeAmount: 0.5, sizeUnit: "gal" },
    });
    await prisma.shoppingListItem.createMany({
      data: [
        { listId: list.id, productId: keep.id, quantity: 1 },
        { listId: list.id, productId: dupe.id, quantity: 2, requestedById: ids.kid },
        { listId: list.id, productId: dupe.id, quantity: 1, done: true },
      ],
    });
    const purchase = await prisma.purchase.create({ data: { householdId: ids.h } });
    await prisma.purchaseItem.create({ data: { purchaseId: purchase.id, productId: dupe.id, description: "Milk 2%", quantity: 1 } });
    await prisma.itemPrice.create({ data: { householdId: ids.h, productId: dupe.id, totalCents: 329, observedAt: new Date() } });
    await prisma.receiptAlias.create({ data: { householdId: ids.h, textKey: `kemps 2 ${Date.now()}`, productId: dupe.id } });

    // Another household can't merge (or even see) these.
    expect(await mergeProducts(ids.other, keep.id, dupe.id)).toEqual({ ok: false, reason: "notFound" });
    expect(await mergeProducts(ids.h, keep.id, keep.id)).toEqual({ ok: false, reason: "same" });

    expect(await mergeProducts(ids.h, keep.id, dupe.id)).toEqual({ ok: true, name: "Milk" });
    expect(await prisma.product.findUnique({ where: { id: dupe.id } })).toBeNull();

    const kept = await prisma.product.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept).toMatchObject({ barcode: dupe.barcode, brand: "Kemps", sizeAmount: 1, sizeUnit: "gal", container: "jug" });

    const rows = await prisma.shoppingListItem.findMany({ where: { productId: keep.id }, orderBy: { done: "asc" } });
    expect(rows.map((r) => [r.done, r.quantity])).toEqual([
      [false, 3],
      [true, 1],
    ]);
    expect(rows[0].requestedById).toBe(ids.kid);
    expect(await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: purchase.id } })).toMatchObject({ productId: keep.id, description: "Milk 2%" });
    // Phase 24: prices and learned receipt lines move with it instead of cascading away.
    expect(await prisma.itemPrice.count({ where: { productId: keep.id } })).toBe(1);
    expect(await prisma.receiptAlias.count({ where: { productId: keep.id } })).toBe(1);
  });
});
