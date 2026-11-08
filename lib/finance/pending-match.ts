import type { FinSource, Prisma } from "@/app/generated/prisma/client";
import type { prisma, Tx } from "@/lib/prisma";

type Db = Tx | typeof prisma;
const DAY = 86_400_000;
/** How long after a pending charge its posted row can turn up. */
export const POST_WINDOW_DAYS = 10;

export type PendingRow = { id: string; accountId: string; source: FinSource; postedOn: Date; amountCents: number; merchantKey: string };

/**
 * The posted row a pending charge the bank has dropped became, or null: in the same account and
 * from the same feed, 0..10 days later, the same sign and amount within 25%, by the same merchant
 * (pending descriptions often carry a prefix, so one name containing the other counts; with no
 * merchant at all, the closest amount). The closest by merchant, then amount, then day wins.
 * Phase 27 wrote this for surprise marks (lib/finance/gifts.ts); Phase 66c shares it with the
 * pick a person made on the pending row (lib/finance/sync.ts). `where` narrows the candidates
 * to rows that can take what's being handed on.
 */
export async function postedRowFor(db: Db, jarId: string, p: PendingRow, where: Prisma.FinTransactionWhereInput = {}): Promise<{ id: string } | null> {
  const candidates = await db.finTransaction.findMany({
    where: {
      jarId,
      accountId: p.accountId,
      source: p.source,
      state: "ACTIVE",
      pending: false,
      ...where,
      postedOn: { gte: p.postedOn, lte: new Date(p.postedOn.getTime() + POST_WINDOW_DAYS * DAY) },
      amountCents: p.amountCents < 0 ? { lt: 0 } : { gt: 0 },
    },
    select: { id: true, amountCents: true, postedOn: true, merchantKey: true },
  });
  const pKey = p.merchantKey === "-" ? "" : p.merchantKey;
  const sameMerchant = (key: string) => key !== "-" && key !== "" && (key === pKey || pKey.includes(key) || key.includes(pKey));
  const close = candidates
    .filter((c) => Math.abs(c.amountCents - p.amountCents) <= Math.abs(p.amountCents) * 0.25)
    .filter((c) => (pKey ? sameMerchant(c.merchantKey) : true));
  close.sort(
    (a, b) =>
      Number(b.merchantKey === pKey) - Number(a.merchantKey === pKey) ||
      Math.abs(a.amountCents - p.amountCents) - Math.abs(b.amountCents - p.amountCents) ||
      a.postedOn.getTime() - b.postedOn.getTime(),
  );
  return close[0] ? { id: close[0].id } : null;
}

/**
 * Phase 66c: when the bank drops pending rows (their posted rows have just come in, in the same
 * sync), what a person attached to each moves to its posted row: a category they picked, unless
 * the posted row has its own pick; a grocery trip link (with who made it) and a matched order
 * email, unless the posted row already has one. Only rows that can still take something are
 * candidates, and each posted row takes from one pending row, so two coffees dropped together
 * each find their own. Runs once, at that moment, so nothing has to remember what was handed on;
 * a posted row that turns up a sync later isn't matched (the feed drops a pending row when its
 * posted row comes, so that's rare). Before this, the pick was lost and the automatic guess came
 * back. Returns how many rows took something.
 */
export async function carryPendingPicks(db: Db, jarId: string, goneIds: string[]): Promise<number> {
  if (goneIds.length === 0) return 0;
  const picked = await db.finTransaction.findMany({
    where: { jarId, id: { in: goneIds }, OR: [{ categorySource: "PERSON" }, { purchaseId: { not: null } }, { mailOrders: { some: {} } }] },
    select: {
      id: true,
      accountId: true,
      source: true,
      postedOn: true,
      amountCents: true,
      merchantKey: true,
      categoryId: true,
      categorySource: true,
      purchaseId: true,
      purchaseLinkedBy: true,
      _count: { select: { mailOrders: true } },
    },
    orderBy: { postedOn: "asc" },
  });
  const taken: string[] = [];
  const freeCategory: Prisma.FinTransactionWhereInput = { OR: [{ categorySource: null }, { categorySource: { in: ["AUTO", "RULE"] } }] };
  for (const p of picked) {
    const person = p.categorySource === "PERSON";
    const order = p._count.mailOrders > 0;
    const canTake: Prisma.FinTransactionWhereInput[] = [
      ...(person ? [freeCategory] : []),
      ...(p.purchaseId ? [{ purchaseId: null }] : []),
      ...(order ? [{ mailOrders: { none: {} } }] : []),
    ];
    const best = await postedRowFor(db, jarId, p, { id: { notIn: taken }, OR: canTake });
    if (!best) continue;
    let took = false;
    if (person) {
      took ||= (await db.finTransaction.updateMany({ where: { id: best.id, jarId, ...freeCategory }, data: { categoryId: p.categoryId, categorySource: "PERSON" } })).count > 0;
    }
    if (p.purchaseId) {
      const { count } = await db.finTransaction.updateMany({ where: { id: best.id, jarId, purchaseId: null }, data: { purchaseId: p.purchaseId, purchaseLinkedBy: p.purchaseLinkedBy } });
      if (count) await db.finTransaction.updateMany({ where: { id: p.id }, data: { purchaseId: null, purchaseLinkedBy: null } });
      took ||= count > 0;
    }
    // An order email follows only to a row without one of its own (lib/finance/sync.ts carryCategory does the same).
    if (order && !(await db.mailOrder.count({ where: { matchedTxnId: best.id } }))) {
      took ||= (await db.mailOrder.updateMany({ where: { matchedTxnId: p.id }, data: { matchedTxnId: best.id } })).count > 0;
    }
    if (took) taken.push(best.id);
  }
  return taken.length;
}
