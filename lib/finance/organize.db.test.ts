import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { categorizeJar, linkGroceries, ensureCategories } from "./organize";
import { enrichPrivacy, importRows } from "./sync";

/**
 * Phase 26 against a real database: `npm run test:db`. Categories guessed and learned
 * (re-guessed after Privacy enrichment, never over a person's pick), "just this one" vs
 * "always", and grocery trips linked only one-to-one and only to trips this jar's members
 * saved (and re-linked after a restore re-creates trips).
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

describe.skipIf(!RUN)("categories, budget data and grocery links (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", grandma: "", jar: "", gJar: "", account: "", gAccount: "" };
  const users: string[] = [];
  const NOW = new Date("2026-10-10T12:00:00");

  beforeAll(async () => {
    const t = Date.now();
    const h = await prisma.household.create({ data: { name: `e2e-budget-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-b-${firstName}-${t}`, name: firstName } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, grandma] = await Promise.all([person("Dad"), person("Grandma")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const gJar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma", members: { create: [{ personId: grandma.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: `a-${t}`, name: "Checking" } });
    const gAccount = await prisma.finAccount.create({ data: { jarId: gJar.id, source: "MANUAL", externalId: `g-${t}`, name: "Grandma checking" } });
    Object.assign(ids, { h: h.id, dad: dad.id, grandma: grandma.id, jar: jar.id, gJar: gJar.id, account: account.id, gAccount: gAccount.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const catId = async (jarId: string, key: string) => (await prisma.finCategory.findUniqueOrThrow({ where: { jarId_key: { jarId, key } } })).id;

  test("imports are categorized by keyword; a Privacy-paid row is re-guessed with the real merchant", async () => {
    await importRows(ids.jar, ids.account, [
      { externalId: "k1", postedOn: "2026-10-04", amountCents: -8214, description: "KROGER #0412 CINCINNATI OH", memo: null },
      { externalId: "n1", postedOn: "2026-10-01", amountCents: -1599, description: "PWP*NETFLIX.COM PRIVACY.COM", memo: null },
      { externalId: "m1", postedOn: "2026-10-02", amountCents: -500, description: "MYSTERY SHOP", memo: null },
    ]);
    const rows = await prisma.finTransaction.findMany({ where: { jarId: ids.jar }, include: { category: true } });
    const by = (ext: string) => rows.find((r) => r.externalId === ext)!;
    expect(by("k1").category?.key).toBe("groceries");
    expect(by("n1")).toMatchObject({ merchantKey: "netflix", categorySource: "AUTO" });
    expect(by("m1").categoryId).toBeNull();

    // A person's pick on the mystery row survives every later pass.
    await prisma.finTransaction.update({ where: { id: by("m1").id }, data: { categoryId: await catId(ids.jar, "gifts"), categorySource: "PERSON" } });
    await prisma.privacyCharge.create({ data: { jarId: ids.jar, token: "pc1", merchant: "NETFLIX.COM", cardMemo: "Netflix", amountCents: 1599, status: "SETTLED", occurredAt: new Date("2026-09-30T20:00:00Z") } });
    await enrichPrivacy(prisma, ids.jar, NOW);
    await categorizeJar(prisma, ids.jar);
    const after = await prisma.finTransaction.findMany({ where: { jarId: ids.jar }, include: { category: true } });
    expect(after.find((r) => r.externalId === "n1")).toMatchObject({ merchantKey: "netflix", privacyCardMemo: "Netflix" });
    expect(after.find((r) => r.externalId === "n1")!.category?.key).toBe("subscriptions");
    expect(after.find((r) => r.externalId === "m1")!.categorySource).toBe("PERSON");
  });

  test("'just this one' teaches nothing; 'always' applies to past and future rows, not a person's picks", async () => {
    const { setCategory } = await import("@/app/(app)/finances/actions");
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.dad }, omit: { photo: true } });
    await importRows(ids.jar, ids.account, [
      { externalId: "a1", postedOn: "2026-10-03", amountCents: -2999, description: "AMAZON MKTP", memo: null },
      { externalId: "a2", postedOn: "2026-10-05", amountCents: -1500, description: "AMAZON MKTP", memo: null },
    ]);
    const [a1, a2] = await Promise.all(["a1", "a2"].map((e) => prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: e } })));
    const gifts = await catId(ids.jar, "gifts");
    await setCategory(ids.jar, a1.id, gifts, "one");
    expect(await prisma.categoryRule.count({ where: { jarId: ids.jar } })).toBe(0);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: a2.id } })).categoryId).toBe(await catId(ids.jar, "shopping"));

    const home = await catId(ids.jar, "home");
    await setCategory(ids.jar, a2.id, home, "always");
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: a1.id } })).categoryId).toBe(gifts); // a person's pick stays
    await importRows(ids.jar, ids.account, [{ externalId: "a3", postedOn: "2026-10-07", amountCents: -999, description: "AMAZON MKTP", memo: null }]);
    expect(await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "a3" } })).toMatchObject({ categoryId: home, categorySource: "RULE" });
    // Another jar can't set this jar's rows.
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.grandma }, omit: { photo: true } });
    await expect(setCategory(ids.jar, a1.id, home, "one")).rejects.toThrow();
  });

  test("grocery trips: one-to-one, only this jar's members' trips, re-linked after a restore", async () => {
    await ensureCategories(prisma, ids.gJar);
    const trip = await prisma.purchase.create({ data: { householdId: ids.h, purchasedById: ids.dad, purchasedAt: new Date("2026-10-03T18:00:00"), items: { create: [{ description: "Milk" }, { description: "Eggs" }] } } });
    // Grandma's Kroger charge the same week: her jar must never see the family's trip.
    await importRows(ids.gJar, ids.gAccount, [{ externalId: "gk", postedOn: "2026-10-04", amountCents: -4000, description: "KROGER #1", memo: null }]);
    await linkGroceries(prisma, ids.gJar, NOW);
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.gJar, externalId: "gk" } })).purchaseId).toBeNull();

    await linkGroceries(prisma, ids.jar, NOW);
    const k1 = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "k1" } });
    expect(k1).toMatchObject({ purchaseId: trip.id, purchaseLinkedBy: "AUTO" });

    // A restore re-creates trips with new ids: the link drops, and the next pass finds the new trip.
    await prisma.purchase.delete({ where: { id: trip.id } });
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: k1.id } })).purchaseId).toBeNull();
    const again = await prisma.purchase.create({ data: { householdId: ids.h, purchasedById: ids.dad, purchasedAt: new Date("2026-10-03T18:00:00") } });
    await linkGroceries(prisma, ids.jar, NOW);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: k1.id } })).purchaseId).toBe(again.id);

    // Two grocery charges and one trip: nobody guesses.
    await importRows(ids.jar, ids.account, [
      { externalId: "k2", postedOn: "2026-09-21", amountCents: -3000, description: "ALDI 55", memo: null },
      { externalId: "k3", postedOn: "2026-09-22", amountCents: -2000, description: "ALDI 55", memo: null },
    ]);
    await prisma.purchase.create({ data: { householdId: ids.h, purchasedById: ids.dad, purchasedAt: new Date("2026-09-20T18:00:00") } });
    await linkGroceries(prisma, ids.jar, NOW);
    expect(await prisma.finTransaction.count({ where: { jarId: ids.jar, externalId: { in: ["k2", "k3"] }, purchaseId: { not: null } } })).toBe(0);
  });

  test("'No category' sticks, budgets stay in their jar, Bills answers save and undo", async () => {
    const { setCategory, setBudget, markRecurring } = await import("@/app/(app)/finances/actions");
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.dad }, omit: { photo: true } });
    const k1 = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "k1" } });
    await setCategory(ids.jar, k1.id, "", "one");
    await categorizeJar(prisma, ids.jar);
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: k1.id } })).toMatchObject({ categoryId: null, categorySource: "PERSON" });

    const form = (amount: string) => {
      const f = new FormData();
      f.set("amount", amount);
      return f;
    };
    expect(await setBudget(ids.jar, await catId(ids.jar, "groceries"), {}, form("450.50"))).toEqual({ ok: "Saved." });
    expect((await prisma.finCategory.findUniqueOrThrow({ where: { jarId_key: { jarId: ids.jar, key: "groceries" } } })).budgetCents).toBe(45050);
    expect(await setBudget(ids.jar, await catId(ids.jar, "income"), {}, form("100"))).toMatchObject({ error: expect.any(String) });
    expect(await setBudget(ids.jar, await catId(ids.gJar, "groceries"), {}, form("100"))).toMatchObject({ error: expect.any(String) });

    await markRecurring(ids.jar, "netflix", "KEEP");
    await markRecurring(ids.jar, "netflix", "CANCEL");
    expect((await prisma.recurringMark.findUniqueOrThrow({ where: { jarId_key: { jarId: ids.jar, key: "netflix" } } })).status).toBe("CANCEL");
    await markRecurring(ids.jar, "netflix", "CLEAR");
    expect(await prisma.recurringMark.count({ where: { jarId: ids.jar } })).toBe(0);
  });

  test("'Not this trip' isn't undone; a folded statement row hands its trip to the bank row", async () => {
    const { unlinkTrip } = await import("@/app/(app)/finances/actions");
    const { dedupeAccount } = await import("./sync");
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: ids.dad }, omit: { photo: true } });
    const groceries = await catId(ids.jar, "groceries");
    const trip = await prisma.purchase.create({ data: { householdId: ids.h, purchasedById: ids.dad, purchasedAt: new Date("2026-10-07T18:00:00") } });
    await importRows(ids.jar, ids.account, [{ externalId: "w1", postedOn: "2026-10-08", amountCents: -6100, description: "MEIJER 7", memo: null }]);
    const w1 = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "w1" } });
    expect(w1).toMatchObject({ categoryId: groceries, purchaseId: trip.id });

    await unlinkTrip(ids.jar, w1.id);
    await linkGroceries(prisma, ids.jar, NOW);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: w1.id } })).purchaseId).toBeNull();

    // Re-link by hand, then the bank feed's copy arrives and the statement row folds into it.
    await prisma.finTransaction.update({ where: { id: w1.id }, data: { purchaseId: trip.id, purchaseLinkedBy: "PERSON" } });
    const feed = await prisma.finAccount.update({ where: { id: ids.account }, data: {} });
    const bank = await prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: feed.id, source: "SIMPLEFIN", externalId: "bank-w1", postedOn: new Date("2026-10-08T00:00:00Z"), amountCents: -6100, description: "MEIJER 7", merchantKey: "meijer" },
    });
    await prisma.$transaction((tx) => dedupeAccount(tx, ids.jar, ids.account));
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: bank.id } })).toMatchObject({ purchaseId: trip.id, purchaseLinkedBy: "PERSON" });
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: w1.id } })).toMatchObject({ state: "DUPLICATE", purchaseId: null });
  });
});
