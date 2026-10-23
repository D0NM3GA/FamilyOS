import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { todayCivil } from "./budget";
import { isHiddenFrom, visibleIssueWhere, visibleToWhere } from "./gifts";

/**
 * Phase 27 against a real database: `npm run test:db`. Surprises stay hidden from the people
 * they're for on every row of the same charge (a statement row that may be the same money,
 * the posted row of a marked pending charge), only the marker can show one early, and money
 * alerts go once, to current members only, each worked out with what that member may see.
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

describe.skipIf(!RUN)("surprises and money alerts (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", gone: "", jar: "", feed: "", stmt: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-gifts-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-g-${firstName}-${t}`, name: firstName, email: `${firstName}-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom, gone] = await Promise.all([person("Dad"), person("Mom"), person("Gone")]);
    const jar = await prisma.moneyJar.create({
      data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }, { personId: gone.id }] } },
    });
    const feed = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `f-${t}`, name: "Checking" } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, gone: gone.id, jar: jar.id, feed: feed.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const feedRow = (externalId: string, postedOn: string, amountCents: number, description: string, extra: object = {}) =>
    prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: ids.feed, source: "SIMPLEFIN", externalId, postedOn: asDate(postedOn), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
    });
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const seenBy = async (personId: string) =>
    (await prisma.finTransaction.findMany({ where: { jarId: ids.jar, state: "ACTIVE", ...visibleToWhere(personId, today) }, select: { externalId: true } })).map((r) => r.externalId);

  test("marking checks who and when; the surprise vanishes for the people it's for", async () => {
    const { markGift } = await import("@/app/(app)/finances/actions");
    const lego = await feedRow("lego1", dayFrom(-3), -12999, "LEGO STORE");
    await as(ids.dad);
    const mark = (entries: [string, string][]) => markGift(ids.jar, lego.id, {}, form(entries));
    expect(await mark([["revealOn", dayFrom(30)]])).toEqual({ error: "Pick who it's a surprise for." });
    expect(await mark([["hiddenFrom", ids.dad], ["revealOn", dayFrom(30)]])).toEqual({ error: "Pick who it's a surprise for." });
    expect(await mark([["hiddenFrom", ids.mom], ["revealOn", today]])).toEqual({ error: "Pick a day after today." });
    expect(await mark([["hiddenFrom", ids.mom], ["revealOn", dayFrom(400)]])).toEqual({ error: "Pick a day within a year." });
    expect(await mark([["hiddenFrom", ids.mom], ["revealOn", dayFrom(30)]])).toEqual({ ok: "🤫 Shh. It's a surprise." });

    expect(await seenBy(ids.mom)).not.toContain("lego1");
    expect(await seenBy(ids.dad)).toContain("lego1");
    expect(await seenBy(ids.gone)).toContain("lego1");
    const row = await prisma.finTransaction.findUniqueOrThrow({ where: { id: lego.id } });
    expect(isHiddenFrom(row, ids.mom, today)).toBe(true);
    expect(isHiddenFrom(row, ids.mom, dayFrom(30))).toBe(false);

    // Mom can't touch it, even with its id: not re-mark, not re-categorize, not show it.
    const { revealGift, setCategory } = await import("@/app/(app)/finances/actions");
    await as(ids.mom);
    expect(await markGift(ids.jar, lego.id, {}, form([["hiddenFrom", ids.dad], ["revealOn", dayFrom(5)]]))).toEqual({ error: "That charge isn't here anymore." });
    const fun = await prisma.finCategory.create({ data: { jarId: ids.jar, key: "fun-test", name: "Fun", kind: "SPEND" } });
    await setCategory(ids.jar, lego.id, fun.id, "one");
    await revealGift(ids.jar, lego.id);
    const still = await prisma.finTransaction.findUniqueOrThrow({ where: { id: lego.id } });
    expect(still).toMatchObject({ giftById: ids.dad, categoryId: null });
  });

  test("a statement row that may be the same charge gets the mark too, and its question is hidden", async () => {
    const { importRows } = await import("./sync");
    const lego = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "lego1" } });
    // Two days off: not folded automatically, so it would stay ACTIVE and show the gift.
    await importRows(ids.jar, ids.feed, [{ externalId: "ofx:lego", postedOn: dayFrom(-1), amountCents: -12999, description: "LEGO STORE", memo: null }]);
    const stmt = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "ofx:lego" } });
    expect(stmt).toMatchObject({ state: "ACTIVE", giftById: ids.dad, giftHiddenFrom: [ids.mom], giftCopiedFromId: lego.id });
    expect(await seenBy(ids.mom)).not.toContain("ofx:lego");
    const issue = { jarId: ids.jar, resolvedAt: null, kind: "POSSIBLE_DUPLICATE" as const };
    expect(await prisma.reconcileIssue.count({ where: issue })).toBe(1);
    expect(await prisma.reconcileIssue.count({ where: { ...issue, ...visibleIssueWhere(ids.mom, today) } })).toBe(0);
    expect(await prisma.reconcileIssue.count({ where: { ...issue, ...visibleIssueWhere(ids.dad, today) } })).toBe(1);

    // A question with no rows (a sync error) is never hidden.
    await prisma.reconcileIssue.create({ data: { jarId: ids.jar, key: "sync:test", kind: "SYNC_ERROR" } });
    expect(await prisma.reconcileIssue.count({ where: { jarId: ids.jar, resolvedAt: null, kind: "SYNC_ERROR", ...visibleIssueWhere(ids.mom, today) } })).toBe(1);

    // Re-marking through the copy moves the whole group (root included).
    const { markGift } = await import("@/app/(app)/finances/actions");
    await as(ids.dad);
    expect((await markGift(ids.jar, stmt.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", dayFrom(45)]]))).ok).toBeTruthy();
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: lego.id } })).giftRevealOn).toEqual(asDate(dayFrom(45)));

    // "Two different charges": the copy comes off; the real surprise stays hidden.
    const { resolveIssue } = await import("./sync");
    const q = await prisma.reconcileIssue.findFirstOrThrow({ where: issue });
    expect(await resolveIssue(ids.jar, q.id, "DIFFERENT")).toBe(true);
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: stmt.id } })).toMatchObject({ giftRevealOn: null, giftCopiedFromId: null, giftHiddenFrom: [] });
    expect(await seenBy(ids.mom)).toContain("ofx:lego");
    expect(await seenBy(ids.mom)).not.toContain("lego1");
  });

  test("a marked statement row that folds into the bank's row hands the mark over", async () => {
    const { importRows, dedupeAccount } = await import("./sync");
    const { markGift } = await import("@/app/(app)/finances/actions");
    await importRows(ids.jar, ids.feed, [{ externalId: "ofx:watch", postedOn: dayFrom(-6), amountCents: -25000, description: "WATCH SHOP", memo: null }]);
    const stmt = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "ofx:watch" } });
    await as(ids.dad);
    expect((await markGift(ids.jar, stmt.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", dayFrom(10)]]))).ok).toBeTruthy();
    await feedRow("t-watch", dayFrom(-6), -25000, "WATCH SHOP");
    await prisma.$transaction((tx) => dedupeAccount(tx, ids.jar, ids.feed));
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: stmt.id } })).state).toBe("DUPLICATE");
    expect(await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "t-watch" } })).toMatchObject({ giftById: ids.dad, giftCopiedFromId: stmt.id });
    expect(await seenBy(ids.mom)).not.toContain("t-watch");
  });

  test("a marked pending charge hands its mark to the posted row, even under a new id and amount", async () => {
    const { organizeJar } = await import("./organize");
    const { markGift } = await import("@/app/(app)/finances/actions");
    const pend = await feedRow("p-spa", dayFrom(-4), -8000, "PENDING SPA DAY", { pending: true });
    await as(ids.dad);
    expect((await markGift(ids.jar, pend.id, {}, form([["hiddenFrom", ids.mom], ["revealOn", dayFrom(20)]]))).ok).toBeTruthy();
    // While the pending row is still there, nothing is handed on: not even to a close match.
    await feedRow("t-other", dayFrom(-3), -8100, "GROCER");
    await organizeJar(ids.jar);
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "t-other" } })).giftRevealOn).toBeNull();
    // The bank drops the pending row and reports the posted one (tip added) a sync later.
    await prisma.finTransaction.update({ where: { id: pend.id }, data: { state: "SUPERSEDED" } });
    await feedRow("t-spa", dayFrom(-2), -9200, "SPA DAY");
    await organizeJar(ids.jar);
    const posted = await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "t-spa" } });
    expect(posted).toMatchObject({ giftById: ids.dad, giftCopiedFromId: pend.id });
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "t-other" } })).giftRevealOn).toBeNull();
    // Handed on once: a later run doesn't mark another row.
    await feedRow("t-spa2", dayFrom(-1), -9000, "SPA DAY");
    await organizeJar(ids.jar);
    expect((await prisma.finTransaction.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "t-spa2" } })).giftRevealOn).toBeNull();
    expect(await seenBy(ids.mom)).not.toContain("t-spa");

    // Showing it early shows every row of it.
    const { revealGift } = await import("@/app/(app)/finances/actions");
    await revealGift(ids.jar, posted.id);
    expect(await prisma.finTransaction.count({ where: { jarId: ids.jar, OR: [{ id: pend.id }, { giftCopiedFromId: pend.id }], giftRevealOn: { not: null } } })).toBe(0);
    expect(await seenBy(ids.mom)).toContain("t-spa");
  });

  test("money alerts: once, to current members with the switch on, never about a hidden surprise", async () => {
    const { evaluateMoneyAlerts } = await import("./alerts");
    // A monthly bill everyone sees (due in two days) and a monthly surprise only Dad sees.
    for (const [i, d] of [-91, -60, -29].entries()) {
      await feedRow(`net${i}`, dayFrom(d), -1599, "NETFLIX");
      await feedRow(`box${i}`, dayFrom(d), -4500, "TOY BOX CLUB", { giftById: ids.dad, giftHiddenFrom: [ids.mom], giftRevealOn: asDate(dayFrom(60)) });
    }
    await prisma.jarConnection.create({
      data: {
        jarId: ids.jar,
        provider: "PRIVACY",
        encryptedValue: new Uint8Array([1]),
        iv: new Uint8Array([1]),
        authTag: new Uint8Array([1]),
        lastError: "Privacy.com said the key is wrong.",
        lastSuccessAt: new Date(Date.now() - 3 * DAY),
      },
    });
    // Gone left the family; Mom turned sync alerts off.
    await prisma.person.update({ where: { id: ids.gone }, data: { isHouseholdMember: false, role: null } });
    await prisma.moneyJarMember.update({ where: { jarId_personId: { jarId: ids.jar, personId: ids.mom } }, data: { alertSync: false } });
    // Dad asked for over-budget alerts; Dining is over this month.
    await prisma.moneyJarMember.update({ where: { jarId_personId: { jarId: ids.jar, personId: ids.dad } }, data: { alertOverBudget: true } });
    const dining = await prisma.finCategory.create({ data: { jarId: ids.jar, key: "dining-test", name: "Dining", kind: "SPEND", budgetCents: 1000 } });
    await feedRow("dine1", today, -5000, "DINER", { categoryId: dining.id, categorySource: "PERSON" });

    const deliver = vi.fn(async () => {});
    const sent = await evaluateMoneyAlerts(new Date(), deliver);
    const notes = await prisma.notification.findMany({ where: { householdId: ids.h }, select: { recipientId: true, kind: true, title: true } });
    const of = (id: string) => notes.filter((n) => n.recipientId === id).map((n) => n.title);
    expect(of(ids.gone)).toEqual([]);
    expect(of(ids.mom).some((x) => x.startsWith("🧾 Netflix is due"))).toBe(true);
    expect(of(ids.mom).some((x) => x.includes("Toy Box"))).toBe(false);
    expect(of(ids.mom).some((x) => x.startsWith("⚠️"))).toBe(false);
    expect(of(ids.dad).some((x) => x.includes("Toy Box Club"))).toBe(true);
    expect(of(ids.dad).some((x) => x.startsWith("⚠️ Privacy.com for Family"))).toBe(true);
    expect(of(ids.dad)).toContain("📊 Dining is over budget this month (Family)");
    expect(of(ids.mom).some((x) => x.startsWith("📊"))).toBe(false);
    expect(notes.every((n) => !/\$|\d+\.\d\d/.test(n.title))).toBe(true);
    // Every jar in the database is evaluated, so other households may add to the count.
    expect(sent).toBeGreaterThanOrEqual(notes.length);
    expect(deliver).toHaveBeenCalledWith({ id: { in: expect.any(Array) } }, { channels: "teams-first", card: expect.objectContaining({ heading: "💰 Money" }) });

    // A second run sends nothing new.
    expect(await evaluateMoneyAlerts(new Date(), deliver)).toBe(0);
    expect(await prisma.notification.count({ where: { householdId: ids.h } })).toBe(notes.length);
  });
});
