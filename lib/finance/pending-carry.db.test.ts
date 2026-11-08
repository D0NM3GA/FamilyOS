import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { carryPendingPicks } from "./pending-match";

/**
 * Phase 66c against a real database (`npm run test:db`): when pending rows drop, what a person
 * attached moves to the posted row each became. Two alike charges dropped together each find
 * their own posted row, and a posted row with its own pick keeps it.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("pending picks carry to posted rows (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", jar: "", account: "", food: "", fun: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-carry-${t}` } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family" } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `a-${t}`, name: "Checking" } });
    const [food, fun] = await Promise.all([
      prisma.finCategory.create({ data: { jarId: jar.id, key: "food", name: "Food", kind: "SPEND" } }),
      prisma.finCategory.create({ data: { jarId: jar.id, key: "fun", name: "Fun", kind: "SPEND" } }),
    ]);
    Object.assign(ids, { h: h.id, jar: jar.id, account: account.id, food: food.id, fun: fun.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const row = (externalId: string, day: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: ids.account, source: "SIMPLEFIN", externalId, postedOn: new Date(`${day}T00:00:00Z`), amountCents, description: "COFFEE", merchantKey: "coffee", ...extra },
    });

  test("two alike pending charges each hand their pick to their own posted row", async () => {
    const [p1, p2] = await Promise.all([
      row(`p1-${t}`, "2026-10-05", -450, { pending: true, state: "SUPERSEDED", categoryId: ids.food, categorySource: "PERSON" }),
      row(`p2-${t}`, "2026-10-05", -460, { pending: true, state: "SUPERSEDED", categoryId: ids.fun, categorySource: "PERSON" }),
    ]);
    const [a, b] = await Promise.all([row(`t1-${t}`, "2026-10-06", -450), row(`t2-${t}`, "2026-10-06", -460)]);
    expect(await carryPendingPicks(prisma, ids.jar, [p1.id, p2.id])).toBe(2);
    const after = await prisma.finTransaction.findMany({ where: { id: { in: [a.id, b.id] } }, select: { id: true, categoryId: true, categorySource: true } });
    expect(after.every((r) => r.categorySource === "PERSON")).toBe(true);
    expect(new Set(after.map((r) => r.categoryId))).toEqual(new Set([ids.food, ids.fun]));
  });

  test("a posted row with its own pick keeps it", async () => {
    const p = await row(`p3-${t}`, "2026-10-12", -500, { pending: true, state: "SUPERSEDED", categoryId: ids.food, categorySource: "PERSON" });
    const posted = await row(`t3-${t}`, "2026-10-13", -500, { categoryId: ids.fun, categorySource: "PERSON" });
    expect(await carryPendingPicks(prisma, ids.jar, [p.id])).toBe(0);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: posted.id } })).categoryId).toBe(ids.fun);
  });
});
