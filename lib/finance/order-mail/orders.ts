import { Prisma } from "@/app/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import type { ParsedOrder, Retailer } from "./parse";
import { civilDate, spreadGiftMarks, visibleOrderWhere } from "../gifts";
import { todayCivil } from "../budget";

/**
 * Phase 29: orders read from email, kept per jar and matched to the charge that paid for
 * them. Callers have passed requireJar (or the scan has re-checked membership).
 *
 * Who sees an order: everyone in the jar, as soon as it's read (owner's call: a family jar is
 * shared). The one exception is a surprise: an order matched to a charge hidden from someone
 * is hidden from them with it, because they only ever get orders for charges they can see.
 */

type Db = Tx | typeof prisma;
const DAY = 86_400_000;
const MAX_HASHES = 10;

// ---- matching (pure) ------------------------------------------------------------------------

/** What on a bank row names the retailer (a Privacy-paid row by its real merchant). */
const HINTS: Record<Retailer, RegExp> = {
  AMAZON: /\bamazon|\bamzn/i,
  APPLE: /\bapple\b|apple\.com|\bitunes/i,
  PUBLIX: /\bpublix|\binstacart/i,
};
/** Days after the order day a charge may post (Amazon charges at shipping, which can lag). */
const WINDOW: Record<Retailer, [number, number]> = { AMAZON: [-1, 21], APPLE: [-1, 3], PUBLIX: [0, 1] };
/** Publix pickup is paid at the register, so the charge can differ from the estimate. */
const TOLERANCE: Record<Retailer, number> = { AMAZON: 0, APPLE: 0, PUBLIX: 0.15 };

export type MatchOrder = { id: string; retailer: Retailer; orderedOn: string; totalCents: number | null };
export type MatchTxn = { id: string; postedOn: string; amountCents: number; text: string };

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;

/**
 * Order ↔ charge, one-to-one both ways. A charge is a candidate when it names the retailer,
 * posted inside the retailer's window, and costs the order's total (Publix: within 15%).
 * The best candidate wins (closest amount, then closest day); a tie, or a charge two orders
 * both want, is left for a person. Orders without a total aren't matched automatically.
 * Amazon charges each shipment separately, so a split order won't match: link it by hand.
 */
export function matchOrders(orders: MatchOrder[], txns: MatchTxn[]): [string, string][] {
  const picks: [string, string][] = [];
  for (const o of orders) {
    if (o.totalCents == null || o.totalCents <= 0) continue;
    const [lo, hi] = WINDOW[o.retailer];
    const scored = txns
      .filter((t) => t.amountCents < 0 && HINTS[o.retailer].test(t.text))
      .map((t) => ({ t, gap: dayNum(t.postedOn) - dayNum(o.orderedOn), diff: Math.abs(-t.amountCents - o.totalCents!) }))
      .filter(({ gap, diff }) => gap >= lo && gap <= hi && diff <= o.totalCents! * TOLERANCE[o.retailer])
      .sort((a, b) => a.diff - b.diff || Math.abs(a.gap) - Math.abs(b.gap));
    if (!scored.length) continue;
    const [best, next] = scored;
    if (next && next.diff === best.diff && Math.abs(next.gap) === Math.abs(best.gap)) continue;
    picks.push([o.id, best.t.id]);
  }
  const wanted = new Map<string, number>();
  for (const [, t] of picks) wanted.set(t, (wanted.get(t) ?? 0) + 1);
  return picks.filter(([, t]) => wanted.get(t) === 1);
}

// ---- storing -------------------------------------------------------------------------------

/** Email hashes already read into this jar. */
export async function seenHashes(db: Db, jarId: string, hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const rows = await db.mailOrder.findMany({ where: { jarId, sourceHashes: { hasSome: hashes } }, select: { sourceHashes: true } });
  const all = new Set(rows.flatMap((r) => r.sourceHashes));
  return new Set(hashes.filter((h) => all.has(h)));
}

/** Adds one email's order. Several emails about one order merge: nothing known is overwritten. */
export async function recordOrder(db: Db, jarId: string, personId: string, o: ParsedOrder, hash: string): Promise<void> {
  const key = { jarId_retailer_orderNumber: { jarId, retailer: o.retailer, orderNumber: o.orderNumber } };
  const existing = await db.mailOrder.findUnique({ where: key, select: { totalCents: true, label: true, items: true, orderedOn: true, sourceHashes: true } });
  const orderedOn = new Date(`${o.orderedOn}T00:00:00Z`);
  if (!existing) {
    try {
      await db.mailOrder.create({
        data: { jarId, personId, retailer: o.retailer, orderNumber: o.orderNumber, orderedOn, totalCents: o.totalCents, label: o.label, items: o.items, sourceHashes: [hash] },
      });
      return;
    } catch (err) {
      // Someone else's scan read the same order first: merge into theirs.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      return recordOrder(db, jarId, personId, o, hash);
    }
  }
  const hadItems = Array.isArray(existing.items) && existing.items.length > 0;
  await db.mailOrder.update({
    where: key,
    data: {
      totalCents: existing.totalCents ?? o.totalCents,
      label: existing.label ?? o.label,
      ...(hadItems ? {} : { items: o.items }),
      orderedOn: existing.orderedOn < orderedOn ? existing.orderedOn : orderedOn,
      sourceHashes: [...new Set([...existing.sourceHashes, hash])].slice(-MAX_HASHES),
    },
  });
}

/**
 * Matches the jar's unmatched orders to charges. A match whose charge stopped being an
 * active row (a pending charge that posted under a new id) is let go and tried again; a
 * person's "not this one" is never touched. Runs after every scan and every
 * sync or import (lib/finance/organize.ts), since the charge often arrives after the email.
 */
export async function matchJarOrders(db: Db, jarId: string, now: Date = new Date()): Promise<number> {
  // The charge was replaced (posted under a new id, or folded into the bank's row): the
  // order goes back to be matched again, whoever linked it. A left-out account's charge
  // (IGNORED, Phase 53) keeps its order: it's still listed, and may come back.
  await db.mailOrder.updateMany({
    where: { jarId, matchedTxn: { state: { in: ["DUPLICATE", "SUPERSEDED"] } } },
    data: { matchedTxnId: null, matchedBy: null, matchedAt: null },
  });
  const orders = await db.mailOrder.findMany({
    where: { jarId, matchedTxnId: null, matchedBy: null, totalCents: { not: null } },
    select: { id: true, retailer: true, orderedOn: true, totalCents: true },
  });
  if (!orders.length) return 0;
  const days = orders.map((o) => o.orderedOn.getTime());
  const txns = await db.finTransaction.findMany({
    where: {
      jarId,
      state: "ACTIVE",
      amountCents: { lt: 0 },
      mailOrders: { none: {} },
      postedOn: { gte: new Date(Math.min(...days) - 2 * DAY), lte: new Date(Math.max(...days) + 22 * DAY) },
    },
    select: { id: true, postedOn: true, amountCents: true, merchantKey: true, merchantName: true, description: true, payee: true },
  });
  const pairs = matchOrders(
    orders.map((o) => ({ id: o.id, retailer: o.retailer, orderedOn: o.orderedOn.toISOString().slice(0, 10), totalCents: o.totalCents })),
    txns.map((t) => ({ id: t.id, postedOn: t.postedOn.toISOString().slice(0, 10), amountCents: t.amountCents, text: [t.merchantKey, t.merchantName, t.payee, t.description].filter(Boolean).join(" ") })),
  );
  for (const [orderId, txnId] of pairs) {
    await matchOrder(db, jarId, orderId, txnId, "AUTO", now);
  }
  return pairs.length;
}

/** In one transaction (or the caller's), so a 🎁 order never ends up matched to a charge that didn't take its mark. */
function inTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "$transaction" in db ? (db as typeof prisma).$transaction((tx) => fn(tx)) : fn(db);
}

/**
 * Puts an order on a charge (still unmatched, and for AUTO not refused by a person before),
 * and hands a 🎁 order's mark to the charge in the same transaction. False when someone
 * else matched it first.
 */
export function matchOrder(db: Db, jarId: string, orderId: string, txnId: string, by: "AUTO" | "PERSON", now: Date = new Date()): Promise<boolean> {
  return inTx(db, async (tx) => {
    const { count } = await tx.mailOrder.updateMany({
      where: { id: orderId, jarId, matchedTxnId: null, ...(by === "AUTO" ? { matchedBy: null } : {}) },
      data: { matchedTxnId: txnId, matchedBy: by, matchedAt: now },
    });
    if (count) await carryOrderGift(tx, jarId, orderId, txnId, now);
    return count > 0;
  });
}

/**
 * An order marked 🎁 before its charge arrived: once matched, the charge takes the same mark
 * (and its other rows with it, lib/finance/gifts.ts spreadGiftMarks), so the gift stays hidden
 * where it now shows. A charge that already has its own live mark keeps it.
 */
export async function carryOrderGift(db: Db, jarId: string, orderId: string, txnId: string, now: Date = new Date()): Promise<boolean> {
  const today = todayCivil(now);
  const order = await db.mailOrder.findFirst({
    where: { id: orderId, jarId, giftRevealOn: { gt: civilDate(today) }, NOT: { giftHiddenFrom: { isEmpty: true } } },
    select: { giftById: true, giftHiddenFrom: true, giftRevealOn: true },
  });
  if (!order) return false;
  const { count } = await db.finTransaction.updateMany({
    where: { id: txnId, jarId, OR: [{ giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }] },
    data: { giftById: order.giftById, giftHiddenFrom: order.giftHiddenFrom, giftRevealOn: order.giftRevealOn, giftCopiedFromId: null },
  });
  if (count) await spreadGiftMarks(db, jarId, now);
  return count > 0;
}

// ---- reading (visibility) -----------------------------------------------------------------

const orderSelect = {
  id: true,
  retailer: true,
  orderNumber: true,
  orderedOn: true,
  totalCents: true,
  label: true,
  items: true,
  personId: true,
  matchedTxnId: true,
  matchedBy: true,
  person: { select: { firstName: true } },
  giftById: true,
  giftHiddenFrom: true,
  giftRevealOn: true,
} as const;

/**
 * The orders on these charges. Pass only charges the viewer can see (visibleToWhere); an
 * order that is itself a surprise for the viewer stays out even then.
 */
export function ordersOnCharges(jarId: string, txnIds: string[], viewerId: string, today: string) {
  if (!txnIds.length) return Promise.resolve([]);
  return prisma.mailOrder.findMany({ where: { jarId, matchedTxnId: { in: txnIds }, ...visibleOrderWhere(viewerId, today) }, select: orderSelect });
}

/** The jar's orders not matched to a charge yet, as this viewer may see them (🎁 ones hidden from them aren't). */
export function unmatchedOrders(jarId: string, viewerId: string, today: string) {
  return prisma.mailOrder.findMany({
    where: { jarId, matchedTxnId: null, ...visibleOrderWhere(viewerId, today) },
    orderBy: { orderedOn: "desc" },
    take: 30,
    select: orderSelect,
  });
}

export type OrderView = Awaited<ReturnType<typeof unmatchedOrders>>[number];

/** Items as stored (JSON), defensively typed for display. */
export function orderItems(o: { items: unknown }): { name: string; qty: number; priceCents: number | null }[] {
  if (!Array.isArray(o.items)) return [];
  return o.items
    .filter((i): i is { name: string; qty?: unknown; priceCents?: unknown } => typeof i === "object" && i != null && typeof (i as { name?: unknown }).name === "string")
    .map((i) => ({ name: i.name, qty: typeof i.qty === "number" ? i.qty : 1, priceCents: typeof i.priceCents === "number" ? i.priceCents : null }));
}

export const RETAILER_NAME: Record<Retailer, string> = { AMAZON: "Amazon", APPLE: "Apple", PUBLIX: "Publix" };
