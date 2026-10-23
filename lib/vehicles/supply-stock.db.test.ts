import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addStock, consumeForService, restoreForUndo } from "./supply-stock";

/**
 * Garage-supply stock arithmetic against a real database (Phase 12.5): `npm run test:db`.
 * Skipped by plain `npm test`. Throwaway households, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("supply stock (database)", () => {
  const ids = {} as { h: string; other: string; item: string; oil: string; filter: string; untracked: string; foreign: string };

  beforeAll(async () => {
    const tag = `e2e-${Date.now()}`;
    const h = await prisma.household.create({ data: { name: `e2e supplies ${tag}` } });
    const other = await prisma.household.create({ data: { name: `e2e other ${tag}` } });
    const vehicle = await prisma.vehicle.create({ data: { householdId: h.id, name: "Van" } });
    const item = await prisma.vehicleMaintenanceItem.create({ data: { vehicleId: vehicle.id, title: "Oil change", intervalMiles: 5000 } });
    const oil = await prisma.vehicleSupply.create({ data: { householdId: h.id, name: "Oil", unit: "qt", quantityOnHand: 7, lowThreshold: 5 } });
    const filter = await prisma.vehicleSupply.create({ data: { householdId: h.id, name: "Filter", quantityOnHand: 3, lowThreshold: 0, active: false } });
    const untracked = await prisma.vehicleSupply.create({ data: { householdId: h.id, name: "Rags" } });
    const foreign = await prisma.vehicleSupply.create({ data: { householdId: other.id, name: "Their oil", quantityOnHand: 10 } });
    await prisma.vehicleItemSupply.createMany({
      data: [
        { itemId: item.id, supplyId: oil.id, quantity: 5 },
        { itemId: item.id, supplyId: filter.id, quantity: 1 },
        { itemId: item.id, supplyId: untracked.id, quantity: 2 },
        // Can't happen through the app (the item form checks the household); proves the SQL
        // guard anyway.
        { itemId: item.id, supplyId: foreign.id, quantity: 1 },
      ],
    });
    Object.assign(ids, { h: h.id, other: other.id, item: item.id, oil: oil.id, filter: filter.id, untracked: untracked.id, foreign: foreign.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const log = () => prisma.vehicleServiceLog.create({ data: { itemId: ids.item, doneAt: new Date(), mileage: 1 } });
  const consume = (logId: string) =>
    prisma.$transaction((tx) => consumeForService(tx, { householdId: ids.h, logId, itemId: ids.item }));
  const onHand = async (id: string) => (await prisma.vehicleSupply.findUniqueOrThrow({ where: { id } })).quantityOnHand;
  const uses = (logId: string) => prisma.vehicleServiceSupplyUse.findMany({ where: { logId } });

  test("takes what the item uses, records it, and reports low supplies", async () => {
    const first = await log();
    expect(await consume(first.id)).toEqual(["Oil"]); // 7 - 5 = 2, at or below 5
    expect(await onHand(ids.oil)).toBe(2);
    expect((await uses(first.id)).map((u) => [u.supplyId, u.quantity])).toEqual([[ids.oil, 5]]);
    // Inactive, untracked and other-household supplies are untouched.
    expect(await onHand(ids.filter)).toBe(3);
    expect(await onHand(ids.untracked)).toBeNull();
    expect(await onHand(ids.foreign)).toBe(10);

    // Clamped at zero, and only what was really taken is recorded.
    const second = await log();
    await consume(second.id);
    expect(await onHand(ids.oil)).toBe(0);
    expect((await uses(second.id))[0].quantity).toBe(2);

    // Undo puts back exactly that, in reverse.
    await prisma.$transaction((tx) => restoreForUndo(tx, second.id));
    expect(await onHand(ids.oil)).toBe(2);
    await prisma.$transaction((tx) => restoreForUndo(tx, first.id));
    expect(await onHand(ids.oil)).toBe(7);
  });

  test("two services logged at once never take more than there is", async () => {
    await prisma.vehicleSupply.update({ where: { id: ids.oil }, data: { quantityOnHand: 7 } });
    const [a, b] = await Promise.all([log(), log()]);
    await Promise.all([consume(a.id), consume(b.id)]);
    const taken = [...(await uses(a.id)), ...(await uses(b.id))].reduce((sum, u) => sum + u.quantity, 0);
    expect(await onHand(ids.oil)).toBe(0);
    expect(taken).toBe(7);
  });

  test("+ stock rounds the sum, only touches tracked supplies in this household", async () => {
    await prisma.vehicleSupply.update({ where: { id: ids.oil }, data: { quantityOnHand: 0 } });
    expect(await addStock(prisma, ids.h, ids.oil, 0.1)).toBe(true);
    expect(await addStock(prisma, ids.h, ids.oil, 0.2)).toBe(true);
    expect(await onHand(ids.oil)).toBe(0.3);
    expect(await addStock(prisma, ids.h, ids.untracked, 5)).toBe(false);
    expect(await onHand(ids.untracked)).toBeNull();
    expect(await addStock(prisma, ids.h, ids.foreign, 5)).toBe(false);
    expect(await onHand(ids.foreign)).toBe(10);
  });
});
