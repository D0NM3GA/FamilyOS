import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { todayCivil, shiftMonth } from "./budget";
import { moneySectionSchema, readHouseholdMoney, sealSection, unsealMoney } from "./backup";

/**
 * Phase 31 against a real database: `npm run test:db`. Saving up needs a monthly budget and
 * ends with it; a rollover category is over budget only past what earlier months left; a
 * settled price rise alerts once; the new category fields ride in the sealed backup, and
 * older backups without them still read.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

const DAY = 86_400_000;
const today = todayCivil();
const month = today.slice(0, 7);
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!RUN)("saving up (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", jar: "", feed: "", cat: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-saving-${t}` } });
    const user = await prisma.user.create({ data: { id: `e2e-sv-${t}`, name: "Dad", email: `dad-sv-${t}@example.com` } });
    users.push(user.id);
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id, alertOverBudget: true }] } } });
    const feed = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `f-${t}`, name: "Checking" } });
    const cat = await prisma.finCategory.create({ data: { jarId: jar.id, key: "school-sv", name: "School", kind: "SPEND" } });
    Object.assign(ids, { h: h.id, dad: dad.id, jar: jar.id, feed: feed.id, cat: cat.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: dad.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const feedRow = (externalId: string, postedOn: string, amountCents: number, description: string, extra: object = {}) =>
    prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: ids.feed, source: "SIMPLEFIN", externalId, postedOn: asDate(postedOn), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
    });
  const cat = () => prisma.finCategory.findUniqueOrThrow({ where: { id: ids.cat } });

  test("saving up needs a monthly budget, a goal turns it on, and taking the budget off ends both", async () => {
    const { setBudget, setGoal, setRollover } = await import("@/app/(app)/finances/actions");
    expect(await setRollover(ids.jar, ids.cat, true)).toEqual({ error: "Set a monthly budget first: that's what goes in each month." });
    expect((await setBudget(ids.jar, ids.cat, {}, form([["amount", "100"]]))).ok).toBeTruthy();
    expect(await setGoal(ids.jar, ids.cat, {}, form([["goal", "400"], ["by", shiftMonth(month, -1)]]))).toEqual({ error: "Pick this month or later." });
    expect(await setGoal(ids.jar, ids.cat, {}, form([["goal", "400"], ["by", "2026-13"]]))).toEqual({ error: "Pick the month you need it by." });
    expect(await setGoal(ids.jar, ids.cat, {}, form([["goal", "400"], ["by", shiftMonth(month, 4)]]))).toEqual({ ok: "🎯 Goal set." });
    expect(await cat()).toMatchObject({ rollover: true, rolloverFrom: month, goalCents: 40000, goalMonth: shiftMonth(month, 4) });

    expect((await setBudget(ids.jar, ids.cat, {}, form([["amount", ""]]))).ok).toBe("No budget.");
    expect(await cat()).toMatchObject({ budgetCents: null, rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null });

    await setBudget(ids.jar, ids.cat, {}, form([["amount", "100"]]));
    await setGoal(ids.jar, ids.cat, {}, form([["goal", "300"], ["by", shiftMonth(month, 2)]]));
    expect((await setRollover(ids.jar, ids.cat, false)).ok).toBe("Back to a plain monthly budget.");
    expect(await cat()).toMatchObject({ rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null });
    expect((await setRollover(ids.jar, ids.cat, true)).ok).toBeTruthy();
    const { jarHistory } = await import("./history");
    const lines = (await jarHistory(ids.jar, ids.dad, today, 20)).map((l) => l.text);
    expect(lines).toContain("Dad started saving up leftovers in School");
    expect(lines.some((x) => x.startsWith("Dad set a goal for School: $400.00 by"))).toBe(true);
  });

  test("over budget counts what earlier months left", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    // Saving since two months ago, nothing spent: $200 carried in, $300 to spend this month.
    await prisma.finCategory.update({ where: { id: ids.cat }, data: { rollover: true, rolloverFrom: shiftMonth(month, -2) } });
    await feedRow("fees1", `${month}-01`, -25000, "SCHOOL FEES", { categoryId: ids.cat, categorySource: "PERSON" });
    const deliver = vi.fn(async () => {});
    await evaluateMoneyAlerts(new Date(), deliver);
    const over = () => prisma.notification.count({ where: { householdId: ids.h, kind: "MONEY_OVER_BUDGET" } });
    expect(await over()).toBe(0);
    await feedRow("fees2", `${month}-01`, -6000, "SCHOOL FEES", { categoryId: ids.cat, categorySource: "PERSON" });
    await evaluateMoneyAlerts(new Date(), deliver);
    expect(await over()).toBe(1);
  });

  test("a settled price rise alerts once, without amounts", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    for (const [i, [d, c]] of ([
      [-92, 1599],
      [-62, 1599],
      [-32, 1799],
      [-2, 1799],
    ] as const).entries()) {
      await feedRow(`stream${i}`, dayFrom(d), -c, "STREAMFLIX");
    }
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    const notes = await prisma.notification.findMany({ where: { householdId: ids.h, kind: "MONEY_PRICE_UP" }, select: { title: true } });
    expect(notes).toEqual([{ title: "📈 Streamflix costs more than it used to (Family)" }]);
  });

  test("the sealed backup carries saving up; an older backup without it still reads", async () => {
    await prisma.finCategory.update({ where: { id: ids.cat }, data: { goalCents: 40000, goalMonth: shiftMonth(month, 4) } });
    const section = unsealMoney(sealSection(await readHouseholdMoney(prisma, ids.h)));
    const c = section.jars[0].categories.find((x) => x.key === "school-sv");
    expect(c).toMatchObject({ rollover: true, rolloverFrom: shiftMonth(month, -2), goalCents: 40000, goalMonth: shiftMonth(month, 4) });

    const old = structuredClone(section) as unknown as { jars: { categories: Record<string, unknown>[] }[] };
    for (const k of ["rollover", "rolloverFrom", "goalCents", "goalMonth"]) delete old.jars[0].categories[0][k];
    expect(moneySectionSchema.parse(old).jars[0].categories[0]).toMatchObject({ rollover: false, rolloverFrom: null, goalCents: null, goalMonth: null });
  });
});
