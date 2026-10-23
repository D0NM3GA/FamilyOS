import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { shiftMonth, todayCivil } from "./budget";
import { activityWhere } from "./activity";
import { readManualBills } from "./manual-bills";

/**
 * Against a real database: `npm run test:db`. Bills added by hand (only in their own jar,
 * logged), the Activity spreadsheet (members only, never a surprise meant for the person
 * downloading it, formula-safe, logged), Activity's month and category filters, and a
 * category save that says what went wrong.
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
  return {
    ...real,
    requireActiveProfile: async () => who.profile,
    getActiveProfile: async () => who.profile,
    getAuthPerson: async () => who.profile,
    isOwnSignIn: async () => true,
  };
});

const DAY = 86_400_000;
const today = todayCivil();
const month = today.slice(0, 7);
const lastMonth = shiftMonth(month, -1);
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

describe.skipIf(!RUN)("money tools (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", outsider: "", jar: "", other: "", checking: "", dining: "", otherBill: "", lego: "", coffee: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-tools-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-mt-${firstName}-${t}`, name: firstName, email: `${firstName}-mt-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom, outsider] = await Promise.all([person("Dad"), person("Mom"), person("Outsider")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Outsider's", members: { create: [{ personId: outsider.id }] } } });
    const checking = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `chk-${t}`, name: "Checking" } });
    const dining = await prisma.finCategory.create({ data: { jarId: jar.id, key: "dining", name: "Dining", kind: "SPEND" } });
    const otherBill = await prisma.manualBill.create({
      data: { jarId: other.id, name: "Their rent", amountCents: 100000, cadence: "MONTHLY", nextDue: asDate(dayFrom(5)), createdById: outsider.id },
    });
    const row = (externalId: string, postedOn: string, amountCents: number, description: string, extra: object = {}) =>
      prisma.finTransaction.create({
        data: { jarId: jar.id, accountId: checking.id, source: "SIMPLEFIN", externalId, postedOn: asDate(postedOn), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
      });
    const coffee = await row("coffee", today, -1234, "SQ *BLUE BOTTLE", { categoryId: dining.id, categorySource: "AUTO", merchantKey: "blue bottle" });
    const lego = await row("lego", today, -5000, "LEGO STORE", { giftById: dad.id, giftHiddenFrom: [mom.id], giftRevealOn: asDate(dayFrom(30)) });
    await row("evil", `${lastMonth}-15`, -100, '=HYPERLINK("http://evil.example","click")');
    // A superseded pending row is never shown, so never exported either.
    await row("old-pending", today, -1234, "SQ *BLUE BOTTLE PENDING", { state: "SUPERSEDED", pending: true });
    Object.assign(ids, {
      h: h.id,
      dad: dad.id,
      mom: mom.id,
      outsider: outsider.id,
      jar: jar.id,
      other: other.id,
      checking: checking.id,
      dining: dining.id,
      otherBill: otherBill.id,
      lego: lego.id,
      coffee: coffee.id,
    });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };
  const events = async (kind: "BILL_ADDED" | "BILL_CHANGED" | "BILL_REMOVED" | "EXPORTED" | "HOLDING_ADDED" | "HOLDING_VALUED" | "HOLDING_REMOVED") =>
    (await prisma.jarEvent.findMany({ where: { jarId: ids.jar, kind }, orderBy: { createdAt: "asc" }, select: { actorId: true, data: true } })).map((e) => ({ actorId: e.actorId, data: e.data }));

  test("bills added by hand: anyone in the jar adds, changes and removes them, only in their own jar, and it's logged", async () => {
    const { addManualBill, removeManualBill, updateManualBill } = await import("@/app/(app)/finances/actions");
    await as(ids.dad);
    const fees = { name: "School fees", amount: "120", cadence: "QUARTERLY", nextDue: dayFrom(10) };
    expect(await addManualBill(ids.jar, {}, form({ ...fees, amount: "free" }))).toEqual({ error: "Use a dollar amount, like 120 or 120.50." });
    expect(await addManualBill(ids.jar, {}, form(fees))).toEqual({ ok: "✍️ Added School fees." });
    const [bill] = await readManualBills(prisma, ids.jar);
    expect(bill).toMatchObject({ name: "School fees", amountCents: 12000, cadence: "QUARTERLY", nextDue: dayFrom(10), matchKey: "school fees", createdBy: "Dad" });

    // The other member changes it; another jar's bill can't be reached through this one.
    await as(ids.mom);
    expect(await updateManualBill(ids.jar, ids.otherBill, {}, form(fees))).toEqual({ error: "That bill isn't here anymore." });
    expect(await updateManualBill(ids.jar, bill.id, {}, form({ ...fees, amount: "150.50", matchKey: "springfield schools" }))).toEqual({ ok: "Saved." });
    expect((await readManualBills(prisma, ids.jar))[0]).toMatchObject({ amountCents: 15050, matchKey: "springfield schools" });
    expect(await removeManualBill(ids.jar, ids.otherBill)).toEqual({ error: "That bill isn't here anymore." });
    expect(await prisma.manualBill.count({ where: { id: ids.otherBill } })).toBe(1);

    // Someone outside the jar gets nothing at all.
    await as(ids.outsider);
    await expect(addManualBill(ids.jar, {}, form(fees))).rejects.toThrow("NOT_FOUND");
    await expect(removeManualBill(ids.jar, bill.id)).rejects.toThrow("NOT_FOUND");

    await as(ids.mom);
    expect(await removeManualBill(ids.jar, bill.id)).toEqual({ ok: "Removed." });
    expect(await readManualBills(prisma, ids.jar)).toEqual([]);
    expect(await events("BILL_ADDED")).toEqual([{ actorId: ids.dad, data: { name: "School fees", cents: 12000, cadence: "QUARTERLY" } }]);
    expect(await events("BILL_CHANGED")).toEqual([{ actorId: ids.mom, data: { name: "School fees" } }]);
    expect(await events("BILL_REMOVED")).toEqual([{ actorId: ids.mom, data: { name: "School fees" } }]);
  });

  test("Net worth's things typed in: members add, value and remove them, outsiders get nothing, and it's logged", async () => {
    const { addHolding, removeHolding, removeHoldingValue, valueHolding } = await import("@/app/(app)/finances/actions");
    await as(ids.dad);
    expect(await addHolding(ids.jar, {}, form({ name: "Minivan", kind: "VEHICLE", value: "25000", valuedOn: dayFrom(-200) }))).toEqual({ ok: "Added Minivan." });
    const van = await prisma.finHolding.findFirstOrThrow({ where: { jarId: ids.jar, name: "Minivan" }, select: { id: true } });
    await as(ids.mom);
    expect(await valueHolding(ids.jar, van.id, {}, form({ value: "22000", valuedOn: dayFrom(0) }))).toEqual({ ok: "Saved." });
    expect(await removeHoldingValue(ids.jar, van.id, dayFrom(-200))).toEqual({ ok: "Taken off." });

    // Someone outside the jar gets nothing at all.
    await as(ids.outsider);
    await expect(addHolding(ids.jar, {}, form({ name: "Mine", kind: "HOME", value: "1", valuedOn: dayFrom(0) }))).rejects.toThrow("NOT_FOUND");
    await expect(valueHolding(ids.jar, van.id, {}, form({ value: "1", valuedOn: dayFrom(0) }))).rejects.toThrow("NOT_FOUND");
    await expect(removeHolding(ids.jar, van.id)).rejects.toThrow("NOT_FOUND");
    // Nor through their own jar.
    expect(await removeHolding(ids.other, van.id)).toEqual({ error: "That isn't here anymore." });

    await as(ids.dad);
    expect(await removeHolding(ids.jar, van.id)).toEqual({ ok: "Removed." });
    expect(await events("HOLDING_ADDED")).toEqual([{ actorId: ids.dad, data: { name: "Minivan", kind: "VEHICLE" } }]);
    expect(await events("HOLDING_VALUED")).toEqual([
      { actorId: ids.mom, data: { name: "Minivan", kind: "VEHICLE", cents: 2_200_000, on: dayFrom(0) } },
      { actorId: ids.mom, data: { name: "Minivan", kind: "VEHICLE", cents: null, on: dayFrom(-200) } },
    ]);
    expect(await events("HOLDING_REMOVED")).toEqual([{ actorId: ids.dad, data: { name: "Minivan" } }]);
  });

  test("a bill added by hand that's due soon is a bill alert, for each member, once", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    const bill = await prisma.manualBill.create({
      data: { jarId: ids.jar, name: "Car registration", amountCents: 9500, cadence: "YEARLY", nextDue: asDate(dayFrom(2)), createdById: ids.dad },
    });
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    const notes = await prisma.notification.findMany({ where: { householdId: ids.h, kind: "MONEY_BILL_DUE" }, select: { title: true } });
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toMatch(/^🧾 Car registration is due \w{3} \d{1,2} \(Family\)$/);
    await prisma.manualBill.delete({ where: { id: bill.id } });
  });

  test("Activity's month and category filters, never showing a surprise to the person it's for", async () => {
    const shown = async (personId: string, f: Parameters<typeof activityWhere>[3]) =>
      (await prisma.finTransaction.findMany({ where: activityWhere(ids.jar, personId, today, f), select: { externalId: true }, orderBy: { externalId: "asc" } })).map((r) => r.externalId);
    expect(await shown(ids.dad, { month })).toEqual(["coffee", "lego"]);
    expect(await shown(ids.mom, { month })).toEqual(["coffee"]);
    expect(await shown(ids.dad, { month: lastMonth })).toEqual(["evil"]);
    expect(await shown(ids.dad, { month: null })).toEqual(["coffee", "evil", "lego"]);
    expect(await shown(ids.dad, { month, category: ids.dining })).toEqual(["coffee"]);
    expect(await shown(ids.dad, { month, category: "none" })).toEqual(["lego"]);
    expect(await shown(ids.mom, { month, category: "none" })).toEqual([]);
    // Another jar's account id finds nothing here.
    expect(await shown(ids.dad, { month, account: "not-this-jars" })).toEqual([]);
  });

  test("the spreadsheet: members only, what they may see, formula-safe, and noted in the jar's history", async () => {
    const { POST } = await import("@/app/(app)/finances/[jarId]/export/route");
    const download = (jarId: string, choice: string | null, site = "same-origin", origin: string | null = "http://localhost:3000") => {
      const body = new FormData();
      if (choice != null) body.set("month", choice);
      const headers: Record<string, string> = { "sec-fetch-site": site, host: "localhost:3000" };
      if (origin) headers.origin = origin;
      return POST(new Request(`http://localhost:3000/finances/${jarId}/export`, { method: "POST", body, headers }), {
        params: Promise.resolve({ jarId }),
      });
    };
    const lines = async (res: Response) => (await res.text()).replace(/^\uFEFF/, "").trim().split("\r\n");

    await as(ids.dad);
    const mine = await download(ids.jar, month);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(mine.headers.get("content-disposition")).toBe(`attachment; filename="money-activity-${month}.csv"`);
    const dad = await lines(mine);
    expect(dad).toHaveLength(3);
    expect(dad.some((l) => l.includes("LEGO STORE"))).toBe(true);

    await as(ids.mom);
    const hers = await lines(await download(ids.jar, "all"));
    expect(hers.some((l) => l.includes("LEGO"))).toBe(false);
    expect(hers.some((l) => l.includes("PENDING"))).toBe(false);
    expect(hers.find((l) => l.includes("HYPERLINK"))).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(hers).toHaveLength(3);
    const exported = await events("EXPORTED");
    expect(exported).toHaveLength(2);
    expect(exported).toEqual(
      expect.arrayContaining([
        { actorId: ids.dad, data: { month, count: 2 } },
        { actorId: ids.mom, data: { month: null, count: 2 } },
      ]),
    );

    // A month that can't be, another site, or someone outside the jar: no file.
    expect((await download(ids.jar, "1999-01")).status).toBe(400);
    expect((await download(ids.jar, null)).status).toBe(400);
    expect((await download(ids.jar, month, "cross-site")).status).toBe(403);
    // A browser without Fetch Metadata: the Origin header decides.
    expect((await download(ids.jar, month, "", "https://evil.example")).status).toBe(403);
    expect((await download(ids.jar, month, "", null)).status).toBe(403);
    await as(ids.outsider);
    await expect(download(ids.jar, month)).rejects.toThrow("NOT_FOUND");
    expect(await events("EXPORTED")).toHaveLength(2);
  });

  test("a category save says what went wrong, and what it did", async () => {
    const { setCategory } = await import("@/app/(app)/finances/actions");
    await as(ids.mom);
    // The surprise meant for her can't be found, even with its id.
    expect(await setCategory(ids.jar, ids.lego, ids.dining, "one")).toEqual({ error: "That charge isn't here anymore. Reload to see the latest." });
    expect(await setCategory(ids.jar, ids.coffee, "not-a-category", "one")).toEqual({ error: "That category isn't in this jar anymore. Reload and pick again." });
    expect(await setCategory(ids.jar, ids.coffee, ids.dining, "sometimes" as "one")).toEqual({ error: "That didn't look right. Reload and try again." });
    expect(await setCategory(ids.jar, ids.coffee, "", "one")).toEqual({ ok: "Saved: no category." });
    expect(await setCategory(ids.jar, ids.coffee, ids.dining, "always")).toEqual({ ok: "Every Blue Bottle charge is Dining now." });
    expect(await prisma.categoryRule.count({ where: { jarId: ids.jar, key: "blue bottle" } })).toBe(1);
  });
});
