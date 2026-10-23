import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrCreateActiveList } from "@/lib/shopping-list";
import { addProductToList, putRowBack, takeRowOff } from "./list";
import { getPantryItems } from "./queries";

/**
 * The list's − with Undo, and the Pantry search box, against a real database:
 * `npm run test:db`. Undo puts back the very same row (amount, "for", kid pick) and never
 * doubles up; neither crosses households.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("taking a row off and putting it back (database)", () => {
  const ids = { h: "", other: "", mom: "", kid: "", list: "", otherList: "", goldfish: "", milk: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-undo-${Date.now()}` } });
    const other = await prisma.household.create({ data: { name: `e2e-undo-other-${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const goldfish = await prisma.product.create({ data: { householdId: h.id, name: "Goldfish crackers", nameKey: "goldfish cracker", brand: "Pepperidge Farm" } });
    const milk = await prisma.product.create({ data: { householdId: h.id, name: "Milk", nameKey: "milk" } });
    const list = await getOrCreateActiveList(h.id);
    const otherList = await getOrCreateActiveList(other.id);
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, kid: kid.id, list: list.id, otherList: otherList.id, goldfish: goldfish.id, milk: milk.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("Undo puts back the same row, once", async () => {
    await addProductToList(ids.h, ids.list, ids.goldfish, { id: ids.kid, role: "KID" });
    const before = await prisma.shoppingListItem.update({
      where: { id: (await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: ids.goldfish } })).id },
      data: { quantity: 0.5 },
    });

    // Not theirs to take off.
    expect(await takeRowOff(ids.other, before.id)).toBeNull();

    const removed = await takeRowOff(ids.h, before.id);
    expect(removed).toEqual({
      name: "Goldfish crackers",
      row: { productId: ids.goldfish, quantity: 0.5, done: false, addedById: ids.kid, requestedById: ids.kid, kidPick: true },
    });
    expect(await prisma.shoppingListItem.findUnique({ where: { id: before.id } })).toBeNull();
    // A second phone tapping − on the same row finds nothing to do.
    expect(await takeRowOff(ids.h, before.id)).toBeNull();

    // Another family can't use it to put something on their list.
    expect(await putRowBack(ids.other, ids.otherList, removed!.row)).toBe("gone");

    expect(await putRowBack(ids.h, ids.list, removed!.row)).toBe("restored");
    expect(await putRowBack(ids.h, ids.list, removed!.row)).toBe("already");
    const rows = await prisma.shoppingListItem.findMany({ where: { listId: ids.list, productId: ids.goldfish } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 0.5, done: false, addedById: ids.kid, requestedById: ids.kid, kidPick: true });
  });

  test("a checked-off row comes back checked off, even beside a fresh one", async () => {
    const row = await prisma.shoppingListItem.create({ data: { listId: ids.list, productId: ids.milk, done: true, addedById: ids.mom } });
    const removed = await takeRowOff(ids.h, row.id);
    await addProductToList(ids.h, ids.list, ids.milk, { id: ids.mom, role: "ADMIN" });

    expect(await putRowBack(ids.h, ids.list, removed!.row)).toBe("restored");
    const rows = await prisma.shoppingListItem.findMany({ where: { listId: ids.list, productId: ids.milk }, orderBy: { done: "asc" } });
    expect(rows.map((r) => r.done)).toEqual([false, true]);
  });

  test("someone who left the family is dropped from the row; a deleted item can't come back", async () => {
    const aunt = await prisma.person.create({ data: { householdId: ids.h, firstName: "Aunt May", role: "ADULT", isHouseholdMember: true } });
    const product = await prisma.product.create({ data: { householdId: ids.h, name: "Tea", nameKey: "tea" } });
    const row = await prisma.shoppingListItem.create({ data: { listId: ids.list, productId: product.id, addedById: aunt.id, requestedById: ids.kid } });
    const removed = await takeRowOff(ids.h, row.id);
    await prisma.person.delete({ where: { id: aunt.id } });

    expect(await putRowBack(ids.h, ids.list, removed!.row)).toBe("restored");
    expect(await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: product.id } })).toMatchObject({
      addedById: null,
      requestedById: ids.kid,
    });

    const again = await takeRowOff(ids.h, (await prisma.shoppingListItem.findFirstOrThrow({ where: { productId: product.id } })).id);
    await prisma.product.delete({ where: { id: product.id } });
    expect(await putRowBack(ids.h, ids.list, again!.row)).toBe("gone");
  });

  test("Pantry search matches every word against the name or the brand, in this family only", async () => {
    await prisma.product.create({ data: { householdId: ids.other, name: "Goldfish crackers", nameKey: "goldfish cracker" } });
    const names = async (q: string) => (await getPantryItems(ids.h, q)).map((p) => p.name);

    expect(await names("gold")).toEqual(["Goldfish crackers"]);
    expect(await names("PEPPERIDGE goldfish")).toEqual(["Goldfish crackers"]);
    expect(await names("pepperidge milk")).toEqual([]);
    expect(await names("")).toEqual(["Goldfish crackers", "Milk"]);
  });
});
