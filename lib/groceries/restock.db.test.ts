import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestItemByName, getOrCreateActiveList } from "@/lib/shopping-list";

/**
 * Phase 63a against a real database (`npm run test:db`): a medicine and a car supply put on the
 * list by their hooks are asked about when a grown-up finishes the trip, restocked once (a second
 * Finish does nothing twice), never for a kid, and never another household's.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

describe.skipIf(!RUN)("restock from a trip (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", other: "", dad: "", ivy: "", med: "", supply: "", otherSupply: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-restock-${t}` } });
    const other = await prisma.household.create({ data: { name: `e2e-restock-other-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const ivy = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const def = await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Vitamin D", domain: "MED", frequencyType: "DAILY", startDate: new Date(), medication: { create: { quantityOnHand: 2, doseAmount: 1 } } },
      include: { medication: true },
    });
    const supply = await prisma.vehicleSupply.create({ data: { householdId: h.id, name: "Motor oil", unit: "qt", quantityOnHand: 1 } });
    const otherSupply = await prisma.vehicleSupply.create({ data: { householdId: other.id, name: "Wiper fluid", quantityOnHand: 1 } });
    Object.assign(ids, { h: h.id, other: other.id, dad: dad.id, ivy: ivy.id, med: def.medication!.id, supply: supply.id, otherSupply: otherSupply.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const asPerson = async (id: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
  };
  const putOnList = async () => {
    await requestItemByName({ householdId: ids.h, name: "Vitamin D", addedById: ids.dad, source: { medicationId: ids.med } });
    await requestItemByName({ householdId: ids.h, name: "Motor oil", addedById: ids.dad, source: { vehicleSupplyId: ids.supply } });
    const list = await getOrCreateActiveList(ids.h);
    await prisma.shoppingListItem.updateMany({ where: { listId: list.id }, data: { done: true } });
    return prisma.shoppingListItem.findMany({ where: { listId: list.id }, include: { product: true } });
  };
  const stock = async () => ({
    med: (await prisma.medication.findUniqueOrThrow({ where: { id: ids.med } })).quantityOnHand,
    oil: (await prisma.vehicleSupply.findUniqueOrThrow({ where: { id: ids.supply } })).quantityOnHand,
  });

  test("a grown-up is asked, restocks once, and another household's ids do nothing", async () => {
    const { completeTrip, tripRestockQuestions } = await import("@/app/(app)/groceries/actions");
    const items = await putOnList();
    await asPerson(ids.dad);
    const asks = await tripRestockQuestions();
    expect(asks.map((q) => [q.name, q.onHand, q.unit]).sort()).toEqual([
      ["Motor oil", 1, "qt"],
      ["Vitamin D", 2, null],
    ]);

    const byName = (n: string) => items.find((i) => i.product.name === n)!.id;
    const restock = [
      { itemId: byName("Vitamin D"), amount: 90 },
      { itemId: byName("Motor oil"), amount: 5 },
    ];
    const [first, second] = await Promise.all([completeTrip(restock), completeTrip(restock)]);
    expect([first.saved, second.saved].filter(Boolean)).toHaveLength(1);
    expect(await stock()).toEqual({ med: 92, oil: 6 });
    expect(await prisma.purchase.count({ where: { householdId: ids.h } })).toBe(1);
    expect((await prisma.vehicleSupply.findUniqueOrThrow({ where: { id: ids.otherSupply } })).quantityOnHand).toBe(1);
  });

  test("another household's supply and an uncounted medicine are never asked about or changed", async () => {
    const { completeTrip, tripRestockQuestions } = await import("@/app/(app)/groceries/actions");
    const list = await getOrCreateActiveList(ids.h);
    const product = await prisma.product.create({ data: { householdId: ids.h, name: "Odd one", nameKey: `odd one ${t}` } });
    const uncounted = await prisma.taskDefinition.create({
      data: { householdId: ids.h, title: "Cough syrup", domain: "MED", frequencyType: "DAILY", startDate: new Date(), medication: { create: { quantityOnHand: null } } },
      include: { medication: true },
    });
    const foreign = await prisma.shoppingListItem.create({ data: { listId: list.id, productId: product.id, done: true, vehicleSupplyId: ids.otherSupply } });
    const product2 = await prisma.product.create({ data: { householdId: ids.h, name: "Syrup", nameKey: `syrup ${t}` } });
    const syrup = await prisma.shoppingListItem.create({ data: { listId: list.id, productId: product2.id, done: true, medicationId: uncounted.medication!.id } });
    await asPerson(ids.dad);
    expect(await tripRestockQuestions()).toEqual([]);
    await completeTrip([
      { itemId: foreign.id, amount: 7 },
      { itemId: syrup.id, amount: 7 },
    ]);
    expect((await prisma.vehicleSupply.findUniqueOrThrow({ where: { id: ids.otherSupply } })).quantityOnHand).toBe(1);
    expect((await prisma.medication.findUniqueOrThrow({ where: { id: uncounted.medication!.id } })).quantityOnHand).toBeNull();
  });

  test("a kid's Finish saves the trip and restocks nothing", async () => {
    const { completeTrip, tripRestockQuestions } = await import("@/app/(app)/groceries/actions");
    const items = await putOnList();
    await asPerson(ids.ivy);
    expect(await tripRestockQuestions()).toEqual([]);
    const result = await completeTrip(items.map((i) => ({ itemId: i.id, amount: 10 })));
    expect(result.saved).toBe(true);
    expect(await stock()).toEqual({ med: 92, oil: 6 });
  });
});
