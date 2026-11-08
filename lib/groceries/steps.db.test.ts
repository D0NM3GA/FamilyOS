import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrCreateActiveList } from "@/lib/shopping-list";

/**
 * Phase 66b against a real database (`npm run test:db`): the list's −/+ step from the amount as
 * it is now, so two phones tapping + both count, and a row another phone already took off or
 * finished is left alone instead of landing on the error page.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("list steps and gone rows (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", list: "", product: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-steps-${t}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const product = await prisma.product.create({ data: { householdId: h.id, name: "Paper towels", nameKey: "paper towel" } });
    const list = await getOrCreateActiveList(h.id);
    Object.assign(ids, { h: h.id, list: list.id, product: product.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: mom.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("two + taps at once make 3, and stepping down to zero takes it off", async () => {
    const { stepQuantity } = await import("@/app/(app)/groceries/actions");
    const row = await prisma.shoppingListItem.create({ data: { listId: ids.list, productId: ids.product, quantity: 1 } });
    await Promise.all([stepQuantity(row.id, 1), stepQuantity(row.id, 1)]);
    expect((await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: row.id } })).quantity).toBe(3);
    await stepQuantity(row.id, -1);
    await stepQuantity(row.id, -1);
    await stepQuantity(row.id, -1);
    expect(await prisma.shoppingListItem.count({ where: { id: row.id } })).toBe(0);
  });

  test("ticking, stepping or naming a row that's gone does nothing", async () => {
    const { setRequestedBy, stepQuantity, toggleItem } = await import("@/app/(app)/groceries/actions");
    await expect(toggleItem("gone", true)).resolves.toBeUndefined();
    await expect(toggleItem("gone", false)).resolves.toBeUndefined();
    await expect(stepQuantity("gone", 1)).resolves.toBeUndefined();
    await expect(setRequestedBy("gone", null)).resolves.toBeUndefined();
  });
});
