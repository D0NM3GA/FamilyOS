import { prisma, type Tx } from "@/lib/prisma";
import { STARTING_CATEGORIES, findCategoryByKey, guessCategory, merchantKeyOf } from "./categories";
import { localDay, matchTrips } from "./grocery-link";
import { spreadGiftMarks } from "./gifts";
import { matchJarOrders } from "./order-mail/orders";

/**
 * Phase 26: the "tidy up" pass after money arrives. It reads a jar's non-PERSON rows each
 * time: fine at family scale (thousands of rows), revisit if a jar ever holds far more.
 * A trip links to one charge per jar (two jars sharing a member could each link it).
 * Trips are matched by who saved them, so a trip finished on a kid's profile isn't offered. Idempotent, safe to run any time; runs
 * last in every sync (after Privacy enrichment, so rules key on the real merchant) and
 * import (after duplicates fold), and after a person sets an "always" category.
 * Callers have passed requireJar; everything is scoped by jar id.
 */

type Db = Tx | typeof prisma;
const DAY = 86_400_000;
const LINK_WINDOW_DAYS = 60;

/** Seeds a jar's categories once (a jar that already has any keeps what it has). */
export async function ensureCategories(db: Db, jarId: string) {
  if ((await db.finCategory.count({ where: { jarId } })) > 0) return;
  await db.finCategory.createMany({
    data: STARTING_CATEGORIES.map((c, i) => ({ jarId, key: c.key, name: c.name, emoji: c.emoji, kind: c.kind, sortOrder: i })),
    skipDuplicates: true,
  });
}

/**
 * Phase 37: one change to a jar's categories at a time. Removing a category (lib/finance
 * /category-edits.ts) takes it, and so does the tidy-up between reading category ids and
 * writing them onto charges, so a removal can't land in between and leave the write pointing
 * at a category that's gone.
 */
export async function lockJarCategories(tx: Tx, jarId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"fin_category:" + jarId}))`;
}

/** Runs `fn` holding the jar's category lock: in `db` when it's already a transaction, else in a new one. */
async function withCategoryLock<T>(db: Db, jarId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = async (tx: Tx) => {
    await lockJarCategories(tx, jarId);
    return fn(tx);
  };
  // A big first tidy-up writes thousands of rows: more time than an interactive transaction's 5s default.
  return "$transaction" in db ? db.$transaction(run, { timeout: 60_000, maxWait: 10_000 }) : run(db);
}

/**
 * Rule for the merchant, else a keyword guess, else uncategorized. Never touches a category a
 * person chose (PERSON). Only rows whose answer changes are written, grouped per category. A
 * guess goes to the category with that starting key, or the one it was removed into.
 */
export async function categorizeJar(db: Db, jarId: string): Promise<number> {
  await ensureCategories(db, jarId);
  // Rows from before Phase 26 have no merchant key yet.
  const keyless = await db.finTransaction.findMany({
    where: { jarId, merchantKey: "" },
    select: { id: true, merchantName: true, payee: true, description: true },
  });
  for (const r of keyless) {
    await db.finTransaction.update({ where: { id: r.id }, data: { merchantKey: merchantKeyOf(r) || "-" } });
  }
  return withCategoryLock(db, jarId, async (tx) => {
    const [categories, rules, rows] = await Promise.all([
      tx.finCategory.findMany({ where: { jarId }, select: { id: true, key: true, absorbedKeys: true } }),
      tx.categoryRule.findMany({ where: { jarId }, select: { key: true, categoryId: true } }),
      tx.finTransaction.findMany({
        where: { jarId, state: "ACTIVE", OR: [{ categorySource: null }, { categorySource: { in: ["AUTO", "RULE"] } }] },
        select: { id: true, merchantKey: true, amountCents: true, categoryId: true, categorySource: true },
      }),
    ]);
    const ruleFor = new Map(rules.map((r) => [r.key, r.categoryId]));

    const writes = new Map<string, string[]>(); // "<categoryId|null>:<source|null>" → ids
    for (const r of rows) {
      const ruled = r.merchantKey ? ruleFor.get(r.merchantKey) : undefined;
      const guessed = ruled ? undefined : guessCategory(r.merchantKey, r.amountCents);
      const categoryId = ruled ?? (guessed ? (findCategoryByKey(categories, guessed)?.id ?? null) : null);
      const source = ruled ? "RULE" : categoryId ? "AUTO" : null;
      if (r.categoryId === categoryId && r.categorySource === source) continue;
      const k = `${categoryId ?? ""}:${source ?? ""}`;
      writes.set(k, [...(writes.get(k) ?? []), r.id]);
    }
    let changed = 0;
    for (const [k, ids] of writes) {
      const [categoryId, source] = k.split(":");
      const { count } = await tx.finTransaction.updateMany({
        where: { id: { in: ids }, jarId, OR: [{ categorySource: null }, { categorySource: { in: ["AUTO", "RULE"] } }] },
        data: { categoryId: categoryId || null, categorySource: (source || null) as "AUTO" | "RULE" | null },
      });
      changed += count;
    }
    return changed;
  });
}

/**
 * Links Groceries charges to the grocery trip they paid for, one-to-one, only with trips a
 * member of this jar saved, over the last 60 days of unlinked rows (so automatic links come
 * back after a restore re-creates trips).
 */
export async function linkGroceries(db: Db, jarId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LINK_WINDOW_DAYS * DAY);
  const [jar, categories] = await Promise.all([
    db.moneyJar.findUnique({ where: { id: jarId }, select: { householdId: true, members: { select: { personId: true } } } }),
    db.finCategory.findMany({ where: { jarId }, select: { id: true, key: true, absorbedKeys: true } }),
  ]);
  // Groceries, or the category it was removed into (Phase 37).
  const groceries = findCategoryByKey(categories, "groceries");
  if (!jar || !groceries) return 0;
  const [txns, trips, taken] = await Promise.all([
    db.finTransaction.findMany({
      // purchaseLinkedBy PERSON with no trip = a person said "not this trip": leave it alone.
      where: {
        jarId,
        state: "ACTIVE",
        amountCents: { lt: 0 },
        categoryId: groceries.id,
        purchaseId: null,
        // AUTO with no trip = its trip was re-created by a restore: link again.
        OR: [{ purchaseLinkedBy: null }, { purchaseLinkedBy: "AUTO" }],
        postedOn: { gte: since },
      },
      select: { id: true, postedOn: true },
    }),
    db.purchase.findMany({
      where: { householdId: jar.householdId, purchasedById: { in: jar.members.map((m) => m.personId) }, purchasedAt: { gte: new Date(since.getTime() - 5 * DAY) } },
      select: { id: true, purchasedAt: true },
    }),
    db.finTransaction.findMany({ where: { jarId, state: "ACTIVE", purchaseId: { not: null } }, select: { purchaseId: true } }),
  ]);
  const used = new Set(taken.map((t) => t.purchaseId));
  const pairs = matchTrips(
    txns.map((t) => ({ id: t.id, postedOn: t.postedOn.toISOString().slice(0, 10) })),
    trips.filter((p) => !used.has(p.id)).map((p) => ({ id: p.id, day: localDay(p.purchasedAt) })),
  );
  for (const [txnId, purchaseId] of pairs) {
    await db.finTransaction.updateMany({ where: { id: txnId, jarId, purchaseId: null }, data: { purchaseId, purchaseLinkedBy: "AUTO" } });
  }
  return pairs.length;
}

/**
 * Categorize, then link trips (linking needs the Groceries category), then spread surprise
 * marks, then match order emails (Phase 29: the charge often arrives after the email).
 */
export async function organizeJar(jarId: string, now: Date = new Date()) {
  await categorizeJar(prisma, jarId);
  await linkGroceries(prisma, jarId, now);
  await spreadGiftMarks(prisma, jarId, now);
  await matchJarOrders(prisma, jarId, now);
}
