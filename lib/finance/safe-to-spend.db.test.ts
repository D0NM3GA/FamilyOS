import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { todayCivil } from "./budget";
import { moneySectionSchema, readHouseholdMoney } from "./backup";

/**
 * Phase 32 against a real database: `npm run test:db`. Only this jar's bank-feed accounts can be
 * spending money; the cushion saves and clears; a tight pay period warns once, without amounts;
 * the new settings ride in the sealed backup (restore: lib/finance/backup.test.ts).
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
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!RUN)("safe to spend (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", jar: "", other: "", checking: "", card: "", manual: "", foreign: "", income: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-safe-${t}` } });
    const user = await prisma.user.create({ data: { id: `e2e-sf-${t}`, name: "Dad", email: `dad-sf-${t}@example.com` } });
    users.push(user.id);
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id, alertBills: false, alertSync: false }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Other", members: { create: [{ personId: dad.id }] } } });
    const acct = (jarId: string, source: "SIMPLEFIN" | "MANUAL", name: string, extra: object = {}) =>
      prisma.finAccount.create({ data: { jarId, source, externalId: `${name}-${t}`, name, ...extra } });
    const checking = await acct(jar.id, "SIMPLEFIN", "Checking", { availableCents: 100000, balanceCents: 100000, balanceAt: new Date() });
    const card = await acct(jar.id, "SIMPLEFIN", "Visa", { balanceCents: -40000, balanceAt: new Date() });
    const manual = await acct(jar.id, "MANUAL", "Old statements");
    const foreign = await acct(other.id, "SIMPLEFIN", "Their checking");
    const income = await prisma.finCategory.create({ data: { jarId: jar.id, key: "income", name: "Income", kind: "INCOME" } });
    Object.assign(ids, { h: h.id, dad: dad.id, jar: jar.id, other: other.id, checking: checking.id, card: card.id, manual: manual.id, foreign: foreign.id, income: income.id });
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
  const spendingIds = async () => (await prisma.finAccount.findMany({ where: { spending: true, jar: { householdId: ids.h } }, select: { id: true } })).map((a) => a.id);

  test("only this jar's bank-feed accounts can be spending money; the cushion saves and clears", async () => {
    const { setCushion, setSpendingAccounts } = await import("@/app/(app)/finances/actions");
    const r = await setSpendingAccounts(ids.jar, {}, form([["account", ids.checking], ["account", ids.manual], ["account", ids.foreign]]));
    expect(r.ok).toBeTruthy();
    expect(await spendingIds()).toEqual([ids.checking]);
    await setSpendingAccounts(ids.jar, {}, form([]));
    expect(await spendingIds()).toEqual([]);
    await setSpendingAccounts(ids.jar, {}, form([["account", ids.checking]]));

    expect(await setCushion(ids.jar, {}, form([["cushion", "abc"]]))).toEqual({ error: "Use a dollar amount, like 450 or 450.00." });
    expect(await setCushion(ids.jar, {}, form([["cushion", "250"]]))).toEqual({ ok: "Saved." });
    expect((await prisma.moneyJar.findUniqueOrThrow({ where: { id: ids.jar } })).cushionCents).toBe(25000);
    expect(await setCushion(ids.jar, {}, form([["cushion", "0"]]))).toEqual({ ok: "No cushion." });
    await setCushion(ids.jar, {}, form([["cushion", "250"]]));
  });

  test("a tight pay period warns once, without amounts", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    const row = (externalId: string, postedOn: string, amountCents: number, description: string, extra: object = {}) =>
      prisma.finTransaction.create({
        data: { jarId: ids.jar, accountId: ids.checking, source: "SIMPLEFIN", externalId, postedOn: asDate(postedOn), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
      });
    // Paid every two weeks, last 4 days ago: payday in 10 days. Rent due in 3 days, more than the balance.
    for (const [i, d] of [-46, -32, -18, -4].entries()) await row(`pay${i}`, dayFrom(d), 300000, "ACME PAYROLL", { categoryId: ids.income });
    const rentDay = dayFrom(3);
    const back = (months: number) => {
      const [y, m, dd] = rentDay.split("-").map(Number);
      const first = new Date(Date.UTC(y, m - 1 - months, 1));
      const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(dd, dim))).toISOString().slice(0, 10);
    };
    for (const n of [3, 2, 1]) await row(`rent${n}`, back(n), -150000, "OAK APARTMENTS RENT");

    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    const notes = await prisma.notification.findMany({ where: { householdId: ids.h, kind: "MONEY_LOW_BALANCE" }, select: { title: true } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^⚠️ Family may run low before payday \(around \w{3} \d{1,2}\)$/);
  });

  test("the sealed backup carries spending accounts, the cushion and the switch", async () => {
    await prisma.moneyJarMember.update({ where: { jarId_personId: { jarId: ids.jar, personId: ids.dad } }, data: { alertLowBalance: false } });
    const section = moneySectionSchema.parse(JSON.parse(JSON.stringify(await readHouseholdMoney(prisma, ids.h))));
    const fam = section.jars.find((j) => j.name === "Family")!;
    expect(fam.cushionCents).toBe(25000);
    expect(fam.accounts.find((a) => a.name === "Checking")?.spending).toBe(true);
    expect(fam.members[0].alertLowBalance).toBe(false);
  });
});
