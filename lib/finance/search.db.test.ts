import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 69c against a real database (`npm run test:db`): money in search only for a jar member on
 * their own sign-in, surprises hidden, no amounts; an "every branch" rule files the store in any
 * town; a hand-added bill marked paid leaves Coming up; dinners on the calendar week.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown>, own: true };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => who.own, isSessionOwner: async () => who.own };
});

describe.skipIf(!RUN)("money search, branch rules, paid bills, dinners (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", jar: "", account: "", dining: "", user: "" };
  const day = (s: string) => new Date(`${s}T00:00:00Z`);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-money-search-${t}` } });
    const user = await prisma.user.create({ data: { id: `e2e-money-search-${t}`, name: "Dad" } });
    const [dad, mom, ivy] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true, authUserId: user.id } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } }),
    ]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: `a-${t}`, name: "Card" } });
    const dining = await prisma.finCategory.create({ data: { jarId: jar.id, key: "dining", name: "Dining", kind: "SPEND" } });
    const charge = (externalId: string, merchantKey: string, extra: Record<string, unknown> = {}) =>
      prisma.finTransaction.create({ data: { jarId: jar.id, accountId: account.id, source: "MANUAL", externalId, postedOn: day("2026-11-02"), amountCents: -2400, description: merchantKey.toUpperCase(), merchantKey, ...extra } });
    await charge(`p1-${t}`, "joes pizza riverton");
    await charge(`p2-${t}`, "joes pizza springfield");
    // A surprise from Mom, hidden from Dad.
    await charge(`g1-${t}`, "lego store", { giftById: mom.id, giftHiddenFrom: [dad.id], giftRevealOn: day("2099-01-01") });
    await prisma.manualBill.create({ data: { jarId: jar.id, name: "School lunch account", amountCents: 3000, cadence: "MONTHLY", nextDue: day("2026-11-20") } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, jar: jar.id, account: account.id, dining: dining.id, user: user.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
  });

  const as = async (id: string, own = true) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
    who.own = own;
  };

  test("search: a member on their own sign-in sees names, dates and jars; nobody else does", async () => {
    const { searchMoney } = await import("./search");
    await as(ids.dad);
    const groups = await searchMoney(who.profile as never, "pizza");
    expect(groups.map((g) => g.title)).toEqual(["Money"]);
    expect(groups[0].items.map((i) => i.sublabel)).toEqual(["Family · 2026-11-02", "Family · 2026-11-02"]);
    expect(groups[0].items[0].href).toBe(`/finances/${ids.jar}?month=2026-11`);
    expect(JSON.stringify(groups)).not.toMatch(/24\.00|2400/);
    expect((await searchMoney(who.profile as never, "lunch")).map((g) => g.title)).toEqual(["Bills"]);
    // A charge with no merchant shows as "A charge", never the bank's raw text.
    await prisma.finTransaction.create({ data: { jarId: ids.jar, accountId: ids.account, source: "MANUAL", externalId: `k-${t}`, postedOn: new Date("2026-11-03T00:00:00Z"), amountCents: -1234, description: "POS PIZZAHUT 12.34", merchantKey: "-" } });
    expect((await searchMoney(who.profile as never, "pizzahut"))[0].items.map((i) => i.label)).toEqual(["A charge"]);
    // The surprise hidden from Dad doesn't show for him.
    expect(await searchMoney(who.profile as never, "lego")).toEqual([]);
    // A profile switched to with a PIN, a kid, and a grown-up not in the jar: nothing.
    await as(ids.dad, false);
    expect(await searchMoney(who.profile as never, "pizza")).toEqual([]);
    await as(ids.ivy);
    expect(await searchMoney(who.profile as never, "pizza")).toEqual([]);
    await as(ids.mom);
    expect(await searchMoney(who.profile as never, "pizza")).toEqual([]);
  });

  test("an every-branch rule files the store in both towns; forgetting it from either charge works", async () => {
    const { setCategory, forgetRule } = await import("@/app/(app)/finances/actions");
    await as(ids.dad);
    const riverton = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, merchantKey: "joes pizza riverton" } });
    expect(await setCategory(ids.jar, riverton.id, ids.dining, "branches")).toEqual({ ok: "Every Joes Pizza charge, at any branch, is Dining now." });
    const springfield = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, merchantKey: "joes pizza springfield" } });
    expect(springfield).toMatchObject({ categoryId: ids.dining, categorySource: "RULE" });
    // A rule for one branch of its own: forgetting it leaves the every-branch rule.
    await prisma.categoryRule.create({ data: { jarId: ids.jar, key: "joes pizza springfield", categoryId: ids.dining } });
    await forgetRule(ids.jar, "joes pizza springfield");
    expect((await prisma.categoryRule.findMany({ where: { jarId: ids.jar } })).map((r) => r.key)).toEqual(["joes pizza"]);
    await forgetRule(ids.jar, "joes pizza springfield");
    expect(await prisma.categoryRule.count({ where: { jarId: ids.jar } })).toBe(0);
  });

  test("a hand-added bill marked paid leaves Coming up for that day", async () => {
    const { markManualBillPaid } = await import("@/app/(app)/finances/actions");
    const { readManualBills, nextDueOn } = await import("./manual-bills");
    await as(ids.dad);
    const [bill] = await readManualBills(prisma, ids.jar);
    const due = nextDueOn(bill, new Date().toISOString().slice(0, 10))!;
    expect(await markManualBillPaid(ids.jar, bill.id, due)).toMatchObject({ ok: expect.stringContaining("is paid") });
    const [after] = await readManualBills(prisma, ids.jar);
    expect(after.paidDueOn).toBe(due);
    expect(nextDueOn(after, new Date().toISOString().slice(0, 10))).not.toBe(due);
    expect(await markManualBillPaid(ids.jar, bill.id, "2020-01-01")).toEqual({ error: "That bill's due day has changed. Reload to see the latest." });
    // Undo puts it back.
    const { unmarkManualBillPaid } = await import("@/app/(app)/finances/actions");
    await unmarkManualBillPaid(ids.jar, bill.id);
    expect((await readManualBills(prisma, ids.jar))[0].paidDueOn).toBeNull();
  });

  test("dinners show on the calendar week, not the month", async () => {
    const { getAgendaWeek } = await import("@/lib/calendar/queries");
    const { atMidnight } = await import("@/lib/tasks/schedule");
    const today = atMidnight(new Date());
    await prisma.mealPlanDay.create({ data: { householdId: ids.h, day: today, note: "Tacos" } });
    const viewer = { id: ids.dad, householdId: ids.h, role: "ADMIN" as const };
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const week = await getAgendaWeek(viewer, { start: today, days: 7, timeZone: zone });
    expect(week.items.filter((i) => i.kind === "meal").map((i) => i.title)).toEqual(["Dinner: Tacos"]);
    const month = await getAgendaWeek(viewer, { start: today, days: 7, eventsOnly: true, timeZone: zone });
    expect(month.items.some((i) => i.kind === "meal")).toBe(false);
  });
});
