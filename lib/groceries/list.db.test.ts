import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrCreateActiveList, requestItemByName } from "@/lib/shopping-list";
import { addProductToList, applyChecks, vetoKidPick } from "./list";

/**
 * Phase 23 against a real database: `npm run test:db`. Kid picks are tagged and vetoable,
 * a med refill naming a kid is not, a veto pings the kid, and the Shop view's check-off
 * batches stay inside the household with the last op winning.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("kid picks and shop check-offs (database)", () => {
  const ids = { h: "", other: "", mom: "", kid: "", list: "", otherList: "", goldfish: "", milk: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-shop-${Date.now()}` } });
    const other = await prisma.household.create({ data: { name: `e2e-shop-other-${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const goldfish = await prisma.product.create({ data: { householdId: h.id, name: "Goldfish crackers", nameKey: "goldfish cracker" } });
    const milk = await prisma.product.create({ data: { householdId: h.id, name: "Milk", nameKey: "milk" } });
    const list = await getOrCreateActiveList(h.id);
    const otherList = await getOrCreateActiveList(other.id);
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, kid: kid.id, list: list.id, otherList: otherList.id, goldfish: goldfish.id, milk: milk.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("a kid's add is their pick; a repeat add by a grown-up keeps it theirs", async () => {
    await addProductToList(ids.h, ids.list, ids.goldfish, { id: ids.kid, role: "KID" });
    await addProductToList(ids.h, ids.list, ids.goldfish, { id: ids.mom, role: "ADMIN" });
    const rows = await prisma.shoppingListItem.findMany({ where: { listId: ids.list, productId: ids.goldfish } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kidPick: true, requestedById: ids.kid, addedById: ids.kid, quantity: 2 });

    await addProductToList(ids.h, ids.list, ids.milk, { id: ids.mom, role: "ADMIN" });
    expect(await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: ids.milk } })).toMatchObject({
      kidPick: false,
      requestedById: null,
    });
  });

  test("veto removes a kid pick and pings the kid; a med refill for the kid can't be vetoed", async () => {
    await requestItemByName({ householdId: ids.h, name: "Zyrtec", addedById: ids.kid, requestedById: ids.kid });
    const refill = await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, product: { name: "Zyrtec" } } });
    expect(await vetoKidPick(ids.h, refill.id)).toBe(false);
    expect(await vetoKidPick(ids.other, refill.id)).toBe(false);

    const pick = await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: ids.goldfish } });
    expect(await vetoKidPick(ids.other, pick.id)).toBe(false);
    expect(await vetoKidPick(ids.h, pick.id)).toBe(true);
    expect(await prisma.shoppingListItem.findUnique({ where: { id: pick.id } })).toBeNull();
    const ping = await prisma.notification.findFirstOrThrow({ where: { recipientId: ids.kid } });
    expect(ping).toMatchObject({ kind: "GROCERY_NOT_THIS_TIME", title: "Not this time: Goldfish crackers. Maybe next trip!", href: "/groceries" });
  });

  test("a pick already in the cart can't be vetoed", async () => {
    await addProductToList(ids.h, ids.list, ids.goldfish, { id: ids.kid, role: "KID" });
    const pick = await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: ids.goldfish } });
    await prisma.shoppingListItem.update({ where: { id: pick.id }, data: { done: true } });
    expect(await vetoKidPick(ids.h, pick.id)).toBe(false);
  });

  test("check-off batches: last op wins, gone rows and other families are skipped", async () => {
    const milk = await prisma.shoppingListItem.findFirstOrThrow({ where: { listId: ids.list, productId: ids.milk } });
    const theirs = await prisma.product.create({ data: { householdId: ids.other, name: "Milk", nameKey: "milk" } });
    const theirRow = await prisma.shoppingListItem.create({ data: { listId: ids.otherList, productId: theirs.id } });

    const applied = await applyChecks(ids.h, [
      { itemId: milk.id, done: true },
      { itemId: milk.id, done: false },
      { itemId: milk.id, done: true },
      { itemId: "gone", done: true },
      { itemId: theirRow.id, done: true },
    ]);
    expect(applied).toBe(1);
    expect((await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: milk.id } })).done).toBe(true);
    expect((await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: theirRow.id } })).done).toBe(false);
    expect(await applyChecks(ids.h, [])).toBe(0);
  });
});
