import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 70e against a real database (`npm run test:db`): a statement account merged into its feed
 * account (rows, imports and questions move; the overlap folds; the wrong kinds are refused), and a
 * sync's filing looking only at its own days while a refund still finds an older charge.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("money: merging accounts and faster filing (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", jar: "", statement: "", feed: "", other: "" };
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  let n = 0;
  const row = (accountId: string, source: "MANUAL" | "SIMPLEFIN", postedOn: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    prisma.finTransaction.create({ data: { jarId: ids.jar, accountId, source, externalId: `x-${t}-${n++}`, postedOn: day(postedOn), amountCents, description: "CHARGE", merchantKey: "store example", ...extra }, select: { id: true } });

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-money-70e-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const mk = (source: "MANUAL" | "SIMPLEFIN", name: string, extra: Record<string, unknown> = {}) =>
      prisma.finAccount.create({ data: { jarId: jar.id, source, externalId: `${name}-${t}`, name, ...extra }, select: { id: true } });
    const [statement, feed, other] = await Promise.all([mk("MANUAL", "Card (statement)", { importLayouts: { a: { date: 0 } } }), mk("SIMPLEFIN", "Card"), mk("MANUAL", "Old card")]);
    Object.assign(ids, { h: h.id, dad: dad.id, jar: jar.id, statement: statement.id, feed: feed.id, other: other.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("refused: into a statement account, from a feed account, or a left-out one", async () => {
    const { mergeStatementAccount } = await import("./merge-accounts");
    expect((await mergeStatementAccount(ids.jar, ids.statement, ids.other)).ok).toBe(false);
    expect((await mergeStatementAccount(ids.jar, ids.feed, ids.statement)).ok).toBe(false);
    await prisma.finAccount.update({ where: { id: ids.feed }, data: { leftOut: true } });
    expect((await mergeStatementAccount(ids.jar, ids.statement, ids.feed)).ok).toBe(false);
    await prisma.finAccount.update({ where: { id: ids.feed }, data: { leftOut: false } });
  });

  test("a merge moves rows and imports across, and the weeks both cover fold together", async () => {
    const { mergeStatementAccount } = await import("./merge-accounts");
    const imp = await prisma.finImport.create({ data: { jarId: ids.jar, accountId: ids.statement, format: "csv", added: 2 } });
    const older = await row(ids.statement, "MANUAL", "2026-08-01", -1500, { importId: imp.id });
    const overlap = await row(ids.statement, "MANUAL", "2026-10-02", -4520, { importId: imp.id });
    const feedSame = await row(ids.feed, "SIMPLEFIN", "2026-10-02", -4520);
    const done = await mergeStatementAccount(ids.jar, ids.statement, ids.feed);
    expect(done).toMatchObject({ ok: true, moved: 2, into: "Card" });
    expect(await prisma.finAccount.findUnique({ where: { id: ids.statement } })).toBeNull();
    expect((await prisma.finImport.findUniqueOrThrow({ where: { id: imp.id } })).accountId).toBe(ids.feed);
    const [o, d] = await Promise.all([prisma.finTransaction.findUniqueOrThrow({ where: { id: older.id } }), prisma.finTransaction.findUniqueOrThrow({ where: { id: overlap.id } })]);
    expect(o).toMatchObject({ accountId: ids.feed, state: "ACTIVE" });
    expect(d).toMatchObject({ accountId: ids.feed, state: "DUPLICATE", duplicateOfId: feedSame.id });
    expect((await prisma.finAccount.findUniqueOrThrow({ where: { id: ids.feed } })).importLayouts).toEqual({ a: { date: 0 } });
  });

  test("the same statement imported into both: the clash folds and keeps what a person set", async () => {
    const { mergeStatementAccount } = await import("./merge-accounts");
    const { ensureCategories } = await import("./organize");
    await ensureCategories(prisma, ids.jar);
    const dining = await prisma.finCategory.findFirstOrThrow({ where: { jarId: ids.jar, key: "dining" } });
    const second = await prisma.finAccount.create({ data: { jarId: ids.jar, source: "MANUAL", externalId: `second-${t}`, name: "Card again" }, select: { id: true } });
    const shared = `shared-${t}`;
    const inFeed = await prisma.finTransaction.create({ data: { jarId: ids.jar, accountId: ids.feed, source: "MANUAL", externalId: shared, postedOn: day("2026-09-03"), amountCents: -1234, description: "BAKERY", merchantKey: "bakery example" }, select: { id: true } });
    const inStatement = await prisma.finTransaction.create({
      data: { jarId: ids.jar, accountId: second.id, source: "MANUAL", externalId: shared, postedOn: day("2026-09-03"), amountCents: -1234, description: "BAKERY", merchantKey: "bakery example", categoryId: dining.id, categorySource: "PERSON" },
      select: { id: true },
    });
    expect((await mergeStatementAccount(ids.jar, second.id, ids.feed)).ok).toBe(true);
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: inStatement.id } })).toMatchObject({ state: "DUPLICATE", duplicateOfId: inFeed.id });
    expect(await prisma.finTransaction.findUniqueOrThrow({ where: { id: inFeed.id } })).toMatchObject({ categoryId: dining.id, categorySource: "PERSON" });
  });

  test("a windowed duplicate check pairs rows a few days before the window, not older ones", async () => {
    const { dedupeAccount } = await import("./sync");
    const near = await row(ids.feed, "MANUAL", "2026-06-26", -777);
    await row(ids.feed, "SIMPLEFIN", "2026-06-26", -777);
    const far = await row(ids.feed, "MANUAL", "2026-06-20", -888);
    await row(ids.feed, "SIMPLEFIN", "2026-06-20", -888);
    await prisma.$transaction((tx) => dedupeAccount(tx, ids.jar, ids.feed, day("2026-06-30")));
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: near.id } })).state).toBe("DUPLICATE");
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: far.id } })).state).toBe("ACTIVE");
  });

  test("a search never shows a surprise hidden from whoever searches", async () => {
    const { activityWhere } = await import("./activity");
    const mom = await prisma.person.create({ data: { householdId: ids.h, firstName: "Mom", role: "ADULT", isHouseholdMember: true } });
    await row(ids.feed, "SIMPLEFIN", "2026-10-20", -4999, { merchantKey: "lego store example", description: "LEGO STORE", giftById: mom.id, giftHiddenFrom: [ids.dad], giftRevealOn: day("2099-01-01") });
    const today = "2026-11-08";
    const seen = await prisma.finTransaction.findMany({ where: activityWhere(ids.jar, ids.dad, today, { month: "2026-11", q: "lego" }) });
    expect(seen).toHaveLength(0);
    const momSees = await prisma.finTransaction.findMany({ where: activityWhere(ids.jar, mom.id, today, { month: "2026-11", q: "lego" }) });
    expect(momSees).toHaveLength(1);
  });

  test("a sync files its own days; an old automatic pick stays; a refund still finds an older charge", async () => {
    const { categorizeJar, ensureCategories } = await import("./organize");
    await ensureCategories(prisma, ids.jar);
    const shopping = await prisma.finCategory.findFirstOrThrow({ where: { jarId: ids.jar, key: "shopping" } });
    const dining = await prisma.finCategory.findFirstOrThrow({ where: { jarId: ids.jar, key: "dining" } });
    // An old row someone's earlier rule filed: a sync's window shouldn't touch it.
    const old = await row(ids.feed, "SIMPLEFIN", "2026-05-01", -900, { merchantKey: "toy shop example", categoryId: dining.id, categorySource: "AUTO" });
    // A charge long ago, filed by a person; its refund arrives in this sync's window.
    await row(ids.feed, "SIMPLEFIN", "2026-04-01", -5000, { merchantKey: "gadget store example", categoryId: shopping.id, categorySource: "PERSON" });
    const refund = await row(ids.feed, "SIMPLEFIN", "2026-11-05", 5000, { merchantKey: "gadget store example" });
    await categorizeJar(prisma, ids.jar, { since: day("2026-10-27") });
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: old.id } })).categoryId).toBe(dining.id);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: refund.id } })).categoryId).toBe(shopping.id);
  });
});
