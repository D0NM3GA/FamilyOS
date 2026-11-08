import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getRunningLow } from "./queries";

/**
 * Phase 65c against a real database (`npm run test:db`): Home's "Probably running low" weighs how
 * many were bought, lists out-now and within-3-days items soonest first, and leaves out anything
 * already on the list.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("running low (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "" };
  const day = 86_400_000;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-running-low-${t}` } });
    ids.h = h.id;
    const product = (name: string) => prisma.product.create({ data: { householdId: h.id, name, nameKey: `${name.toLowerCase()} ${t}` } });
    const [towels, eggs, rice, soap] = await Promise.all([product("Paper towels"), product("Eggs"), product("Rice"), product("Soap")]);
    // Weekly trips; each line is [product, days ago, quantity].
    const lines: [string, string, number, number][] = [
      // Paper towels: one pack a week, but two bought 9 days ago: about 5 days left (not yet).
      [towels.id, "Paper towels", 30, 1], [towels.id, "Paper towels", 23, 1], [towels.id, "Paper towels", 16, 1], [towels.id, "Paper towels", 9, 2],
      // Eggs: weekly, last 9 days ago: out.
      [eggs.id, "Eggs", 30, 1], [eggs.id, "Eggs", 23, 1], [eggs.id, "Eggs", 16, 1], [eggs.id, "Eggs", 9, 1],
      // Rice: every 10 days, last 8 days ago: about 2 days left.
      [rice.id, "Rice", 28, 1], [rice.id, "Rice", 18, 1], [rice.id, "Rice", 8, 1],
      // Soap: out, but it's on the list.
      [soap.id, "Soap", 30, 1], [soap.id, "Soap", 23, 1], [soap.id, "Soap", 16, 1], [soap.id, "Soap", 9, 1],
    ];
    for (const [productId, description, ago, quantity] of lines) {
      await prisma.purchase.create({ data: { householdId: h.id, purchasedAt: new Date(t - ago * day), items: { create: { productId, description, quantity } } } });
    }
    // Bread's Pantry item was deleted: its history is keyed by description. It's on the list again
    // under a new Pantry item of that name, so it's left out too.
    for (const ago of [30, 23, 16, 9]) {
      await prisma.purchase.create({ data: { householdId: h.id, purchasedAt: new Date(t - ago * day), items: { create: { productId: null, description: "Bread", quantity: 1 } } } });
    }
    const bread = await product("Bread");
    const list = await prisma.shoppingList.create({ data: { householdId: h.id } });
    await prisma.shoppingListItem.create({ data: { listId: list.id, productId: soap.id } });
    await prisma.shoppingListItem.create({ data: { listId: list.id, productId: bread.id } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("out and soon, soonest first; a big last trip lasts longer; nothing on the list", async () => {
    const low = await getRunningLow(ids.h);
    expect(low.map((s) => [s.label, s.daysLeft])).toEqual([
      ["Eggs", -2],
      ["Rice", 2],
    ]);
  });
});
