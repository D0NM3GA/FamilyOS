import type { Prisma } from "@/app/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { todayCivil } from "./budget";

/**
 * Phase 27: surprises. A jar member marks a charge as a gift, hidden from some of the jar's
 * other members until a reveal day. Hidden from someone means they get no row for it
 * anywhere (activity, Needs a look, Bills, alerts); the budget folds it into one
 * "Surprises" total so the month still adds up. The reveal is just the day arriving (a
 * civil day, compared with the server's lib/finance/budget.ts todayCivil()), so nothing
 * has to run for it.
 *
 * One charge can sit on several rows (its pending row and the posted one, a statement row
 * that may be the same money), so the organize pass copies a mark onto those rows too:
 * otherwise the copy that isn't marked would show the gift. Copies point at the row the
 * mark started on (giftCopiedFromId), and the marker changes or reveals the whole group.
 */

type Db = Tx | typeof prisma;
const DAY = 86_400_000;
/** How long after a marked pending charge its posted row can turn up. */
const POST_WINDOW_DAYS = 10;
const LOOKBACK_DAYS = 60;

export const MAX_REVEAL_DAYS = 366;

export const civilDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export type GiftFields = { giftById: string | null; giftHiddenFrom: string[]; giftRevealOn: Date | null };

export function isHiddenFrom(row: Pick<GiftFields, "giftHiddenFrom" | "giftRevealOn">, viewerId: string, today: string): boolean {
  return row.giftRevealOn != null && dayOf(row.giftRevealOn) > today && (row.giftHiddenFrom ?? []).includes(viewerId);
}

/** A mark that hasn't revealed yet (for anyone). */
export function isUnrevealed(row: Pick<GiftFields, "giftHiddenFrom" | "giftRevealOn">, today: string): boolean {
  return row.giftRevealOn != null && dayOf(row.giftRevealOn) > today && (row.giftHiddenFrom ?? []).length > 0;
}

/**
 * Rows the viewer may see. Written as an OR of plain conditions (not NOT(hidden)) so an
 * unmarked row, whose reveal day is NULL, never falls out through SQL's NULL logic.
 */
export function visibleToWhere(viewerId: string, today: string): Prisma.FinTransactionWhereInput {
  return {
    OR: [{ giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }, { NOT: { giftHiddenFrom: { has: viewerId } } }],
  };
}

/** Order emails the viewer may see: an unmatched order can be a surprise too (same rules). */
export function visibleOrderWhere(viewerId: string, today: string): Prisma.MailOrderWhereInput {
  return {
    OR: [{ giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }, { NOT: { giftHiddenFrom: { has: viewerId } } }],
  };
}

/**
 * The "🎁 Surprise?" form, for a charge or an order: who it's hidden from (only other jar
 * members) and the day it shows (after today, within a year).
 */
export function parseGiftForm(
  formData: FormData,
  otherMemberIds: string[],
  today: string,
): { hiddenFrom: string[]; revealOn: string } | { error: string } {
  const allowed = new Set(otherMemberIds);
  const hiddenFrom = [...new Set(formData.getAll("hiddenFrom").map(String))].filter((id) => allowed.has(id));
  if (hiddenFrom.length === 0) return { error: "Pick who it's a surprise for." };
  const revealOn = String(formData.get("revealOn") ?? "");
  const latest = new Date(civilDate(today).getTime() + MAX_REVEAL_DAYS * DAY).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revealOn) || Number.isNaN(civilDate(revealOn).getTime())) return { error: "Pick the day it can be seen." };
  if (revealOn <= today) return { error: "Pick a day after today." };
  if (revealOn > latest) return { error: "Pick a day within a year." };
  return { hiddenFrom, revealOn };
}

export function hiddenFromWhere(viewerId: string, today: string): Prisma.FinTransactionWhereInput {
  return { giftHiddenFrom: { has: viewerId }, giftRevealOn: { gt: civilDate(today) } };
}

/** Open questions the viewer may see: both sides visible to them. */
export function visibleIssueWhere(viewerId: string, today: string): Prisma.ReconcileIssueWhereInput {
  const hidden = hiddenFromWhere(viewerId, today);
  return { NOT: [{ txn: hidden }, { otherTxn: hidden }] };
}

const markSelect = { id: true, giftById: true, giftHiddenFrom: true, giftRevealOn: true, giftCopiedFromId: true } as const;
type Marked = { id: string; giftById: string | null; giftHiddenFrom: string[]; giftRevealOn: Date | null; giftCopiedFromId: string | null };

const rootOf = (r: Marked) => r.giftCopiedFromId ?? r.id;
const copyData = (from: Marked) => ({
  giftById: from.giftById,
  giftHiddenFrom: from.giftHiddenFrom,
  giftRevealOn: from.giftRevealOn,
  giftCopiedFromId: rootOf(from),
});
/** A row that can take a mark: none, or one whose day has come (a revealed mark is history). */
const takesMark = (today: string): Prisma.FinTransactionWhereInput => ({ OR: [{ giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }] });

/** The row ids sharing a mark with this one (itself included). */
export async function giftGroup(db: Db, jarId: string, row: Marked): Promise<string[]> {
  const root = rootOf(row);
  const rows = await db.finTransaction.findMany({ where: { jarId, OR: [{ id: root }, { giftCopiedFromId: root }] }, select: { id: true } });
  return [...new Set([row.id, ...rows.map((r) => r.id)])];
}

/**
 * Copies live (unrevealed) marks onto the other rows of the same charge. Idempotent; runs in
 * the organize pass (after every sync and import) and right after a mark is set.
 *  1. An open "same charge twice?" question: both rows get the mark ("Two different
 *     charges" takes the copy off again, lib/finance/sync.ts resolveIssue).
 *  2. A marked pending row the bank has dropped (SUPERSEDED): its posted row in the same
 *     account and from the same feed, 0..10 days later, amount within 25%, by the same
 *     merchant (pending descriptions often carry a prefix, so one name containing the other
 *     counts; with no merchant at all, the closest amount). Each pending row hands its mark
 *     on once. While the pending row is still there, nothing is handed on: a guess then
 *     could hide an unrelated charge.
 */
export async function spreadGiftMarks(db: Db, jarId: string, now: Date = new Date()): Promise<number> {
  const today = todayCivil(now);
  const live = (r: { giftRevealOn: Date | null }) => r.giftRevealOn != null && dayOf(r.giftRevealOn) > today;
  let copied = 0;

  const issues = await db.reconcileIssue.findMany({
    where: { jarId, resolvedAt: null, kind: "POSSIBLE_DUPLICATE", OR: [{ txn: { giftRevealOn: { gt: civilDate(today) } } }, { otherTxn: { giftRevealOn: { gt: civilDate(today) } } }] },
    select: { txn: { select: markSelect }, otherTxn: { select: markSelect } },
  });
  for (const { txn, otherTxn } of issues) {
    if (!txn || !otherTxn || live(txn) === live(otherTxn)) continue;
    const [from, to] = live(txn) ? [txn, otherTxn] : [otherTxn, txn];
    const { count } = await db.finTransaction.updateMany({ where: { id: to.id, jarId, ...takesMark(today) }, data: copyData(from) });
    copied += count;
  }

  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY);
  const pending = await db.finTransaction.findMany({
    where: { jarId, pending: true, state: "SUPERSEDED", giftRevealOn: { gt: civilDate(today) }, postedOn: { gte: since } },
    select: { ...markSelect, accountId: true, source: true, postedOn: true, amountCents: true, merchantKey: true },
  });
  for (const p of pending) {
    const root = rootOf(p);
    // A statement-row copy in the same group doesn't count: only the feed's own posted row.
    const handedOn = await db.finTransaction.count({
      where: { jarId, accountId: p.accountId, source: p.source, pending: false, id: { not: p.id }, OR: [{ id: root }, { giftCopiedFromId: root }] },
    });
    if (handedOn) continue;
    const candidates = await db.finTransaction.findMany({
      where: {
        jarId,
        accountId: p.accountId,
        source: p.source,
        state: "ACTIVE",
        pending: false,
        ...takesMark(today),
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
    const best = close[0];
    if (!best) continue;
    const { count } = await db.finTransaction.updateMany({ where: { id: best.id, jarId, ...takesMark(today) }, data: copyData(p) });
    copied += count;
  }
  return copied;
}
