import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import type { Receipt } from "@/lib/documents/receipt";
import { matchReceipt, receiptTextKey, unitCentsFor, type LineMatch, type MatchItem } from "./receipt-match";

/**
 * Phase 24: receipts, the Pantry side. A photo is read, matched and shown for review, then
 * only the confirmed prices (and the matches worth remembering) are saved. Nothing about
 * the receipt itself is stored: no image, no scan record.
 */

// A receipt usually comes home the day of the trip; older trips make confident wrong guesses.
const TRIP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type PreparedLine = {
  key: string;
  text: string;
  quantity: number | null;
  unitCents: number | null;
  totalCents: number | null;
  match: LineMatch;
};

export type PreparedReceipt = {
  merchant: string | null;
  date: string | null;
  totalCents: number | null;
  purchaseId: string | null;
  storeId: string | null;
  lines: PreparedLine[];
  tripItems: MatchItem[];
  pantry: MatchItem[];
  stores: { id: string; name: string }[];
};

/** The trip this receipt belongs to: the one asked for, else the latest within three days. */
async function findTrip(householdId: string, purchaseId: string | null, now: Date) {
  const where = purchaseId
    ? { id: purchaseId, householdId }
    : { householdId, purchasedAt: { gte: new Date(now.getTime() - TRIP_WINDOW_MS) } };
  return prisma.purchase.findFirst({
    where,
    orderBy: { purchasedAt: "desc" },
    select: { id: true, items: { select: { productId: true } } },
  });
}

/** A store whose name is in the merchant's (or the other way round), longest first. */
export function matchStore(merchant: string | null, stores: { id: string; name: string }[]): string | null {
  if (!merchant) return null;
  const m = merchant.toLowerCase();
  const hits = stores.filter((s) => {
    const n = s.name.toLowerCase().trim();
    return n.length >= 3 && (m.includes(n) || (m.length >= 3 && n.includes(m)));
  });
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0]?.id ?? null;
}

export async function prepareReceipt(
  householdId: string,
  receipt: Receipt,
  opts: { purchaseId: string | null; now?: Date },
): Promise<PreparedReceipt> {
  const now = opts.now ?? new Date();
  const [trip, products, stores] = await Promise.all([
    findTrip(householdId, opts.purchaseId, now),
    prisma.product.findMany({ where: { householdId }, select: { id: true, name: true, brand: true }, orderBy: { name: "asc" } }),
    prisma.store.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const keys = receipt.lines.map((l) => receiptTextKey(l.text)).filter(Boolean);
  const aliases = await prisma.receiptAlias.findMany({ where: { householdId, textKey: { in: keys } }, select: { textKey: true, productId: true } });

  const tripIds = new Set((trip?.items ?? []).flatMap((i) => (i.productId ? [i.productId] : [])));
  const tripItems = products.filter((p) => tripIds.has(p.id));
  const matches = matchReceipt({
    lines: receipt.lines,
    aliases: new Map(aliases.map((a) => [a.textKey, a.productId])),
    trip: tripItems,
    pantry: products,
  });

  return {
    merchant: receipt.merchant,
    date: receipt.date,
    totalCents: receipt.totalCents,
    purchaseId: trip?.id ?? null,
    storeId: matchStore(receipt.merchant, stores),
    lines: receipt.lines.map((l, i) => ({ ...l, key: matches[i].key, match: matches[i] })),
    tripItems,
    pantry: products,
    stores,
  };
}

export type ReviewLine = {
  key: string;
  productId: string | null;
  quantity: number | null;
  unitCents: number | null;
  totalCents: number | null;
  /** What the review started with, so learning only follows a real choice. */
  initialProductId: string | null;
  initialHow: LineMatch["how"];
};

/** Server-local midnight of a printed YYYY-MM-DD (the way the rest of the app stores days). */
function localDay(date: string | null): Date | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, day);
  // Reject dates that roll over (2026-02-31).
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day ? d : null;
}

/**
 * Saves a reviewed receipt: one ItemPrice per matched line, and the matches worth learning.
 * Learning rule: a line the person matched themselves, or kept as a pre-selected strong
 * guess, teaches its text; changing a learned line re-teaches it; skipping a learned line
 * forgets it. All ids are checked against the household. Returns how many prices were saved.
 */
export async function saveReceiptPrices(
  householdId: string,
  review: { purchaseId: string | null; storeId: string | null; date: string | null; lines: ReviewLine[] },
): Promise<number> {
  const productIds = [...new Set(review.lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
  const [products, store, purchase] = await Promise.all([
    prisma.product.findMany({ where: { householdId, id: { in: productIds } }, select: { id: true } }),
    review.storeId ? prisma.store.findFirst({ where: { id: review.storeId, householdId }, select: { id: true } }) : null,
    review.purchaseId ? prisma.purchase.findFirst({ where: { id: review.purchaseId, householdId }, select: { purchasedAt: true } }) : null,
  ]);
  const owned = new Set(products.map((p) => p.id));
  const observedAt = purchase?.purchasedAt ?? localDay(review.date) ?? new Date();

  const priced = review.lines.filter(
    (l): l is ReviewLine & { productId: string; totalCents: number } =>
      l.productId != null && owned.has(l.productId) && l.totalCents != null && l.totalCents > 0,
  );

  // Learning, resolved per text key (a receipt can print a line twice; any kept line wins).
  // Keys are re-normalized here: the review comes from the browser.
  const learn = new Map<string, string>();
  const keep = new Set<string>();
  const forget = new Set<string>();
  for (const l of review.lines) {
    const key = receiptTextKey(l.key);
    if (!key) continue;
    const kept = l.productId != null && owned.has(l.productId);
    if (kept && l.initialHow === "learned" && l.productId === l.initialProductId) keep.add(key);
    else if (kept) learn.set(key, l.productId!);
    else if (l.initialHow === "learned") forget.add(key);
  }
  for (const key of [...learn.keys(), ...keep]) forget.delete(key);
  for (const key of keep) learn.delete(key);

  const rows = priced.map((l) => ({
    householdId,
    productId: l.productId,
    storeId: store?.id ?? null,
    totalCents: l.totalCents,
    quantity: l.quantity != null && l.quantity > 0 ? l.quantity : 1,
    unitCents: unitCentsFor({ quantity: l.quantity != null && l.quantity > 0 ? l.quantity : null, unitCents: l.unitCents != null && l.unitCents > 0 ? l.unitCents : null, totalCents: l.totalCents }),
    observedAt,
  }));

  // Reading the same receipt twice (after fixing a match, say) mustn't double its prices.
  const existing = rows.length
    ? await prisma.itemPrice.findMany({
        where: { householdId, observedAt, productId: { in: rows.map((r) => r.productId) } },
        select: { productId: true, storeId: true, totalCents: true, quantity: true },
      })
    : [];
  const seen = new Set(existing.map((e) => `${e.productId}|${e.storeId}|${e.totalCents}|${e.quantity}`));
  const fresh = rows.filter((r) => {
    const k = `${r.productId}|${r.storeId}|${r.totalCents}|${r.quantity}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // A constant number of statements, so a long receipt can't outrun the transaction timeout.
  await prisma.$transaction([
    prisma.receiptAlias.deleteMany({ where: { householdId, textKey: { in: [...learn.keys(), ...forget] } } }),
    prisma.receiptAlias.createMany({ data: [...learn].map(([textKey, productId]) => ({ householdId, textKey, productId })) }),
    prisma.itemPrice.createMany({ data: fresh }),
  ]);
  return fresh.length;
}

export type LastPrice = { unitCents: number | null; totalCents: number; quantity: number; storeName: string | null; observedAt: Date };

/**
 * The latest price per item, for the item sheet and the Pantry. DISTINCT ON in SQL: Prisma's
 * `distinct` dedupes in memory, which loaded every price ever recorded.
 */
export async function getLastPrices(householdId: string, productIds?: string[]): Promise<Map<string, LastPrice>> {
  const only = productIds ?? null;
  const rows = await prisma.$queryRaw<(LastPrice & { productId: string })[]>`
    SELECT DISTINCT ON (p."productId")
      p."productId", p."unitCents", p."totalCents", p.quantity, p."observedAt", s.name AS "storeName"
    FROM item_price p
    LEFT JOIN store s ON s.id = p."storeId"
    WHERE p."householdId" = ${householdId}
      AND (${only}::text[] IS NULL OR p."productId" = ANY(${only}::text[]))
    ORDER BY p."productId", p."observedAt" DESC, p."createdAt" DESC`;
  return new Map(rows.map(({ productId, ...price }) => [productId, price]));
}

/** "$54.99 at Target · Oct 4", or "$4.66 for 2.34 at Aldi · Oct 4" when there's no per-one price. */
export function describeLastPrice(p: LastPrice): string {
  const price = p.unitCents != null ? formatMoney(p.unitCents) : `${formatMoney(p.totalCents)} for ${Math.round(p.quantity * 100) / 100}`;
  const when = p.observedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${price}${p.storeName ? ` at ${p.storeName}` : ""} · ${when}`;
}
