import { prisma } from "@/lib/prisma";
import { visibleToWhere } from "./gifts";
import { tidyMerchantName } from "./merchant-name";

/**
 * Phase 64d: "New since you last looked" on a jar (the owner's call). Charges that arrived (by
 * createdAt, or postedAt for a hold that posted on its own row) after this member last looked:
 * active, not pending (a hold can still change or vanish), not hidden from them as a surprise. A first look counts the last 30
 * days as new. The newest 100 are shown; "Mark all seen" clears the rest.
 */
export const NEW_SINCE_MAX = 100;
export const FIRST_LOOK_DAYS = 30;

export function newSinceCutoff(lastSeenAt: Date | null, now: Date = new Date()): Date {
  return lastSeenAt ?? new Date(now.getTime() - FIRST_LOOK_DAYS * 86_400_000);
}

const where = (jarId: string, viewerId: string, today: string, cutoff: Date) => ({
  jarId,
  state: "ACTIVE" as const,
  pending: false,
  // Arrived since, or a hold that posted on its own row since (lib/finance/sync.ts).
  // (An AND, as the surprise rule brings its own OR.)
  AND: [{ OR: [{ createdAt: { gt: cutoff } }, { postedAt: { gt: cutoff } }] }, visibleToWhere(viewerId, today)],
});

export async function newSince(jarId: string, viewerId: string, lastSeenAt: Date | null, today: string, now: Date = new Date()) {
  const cutoff = newSinceCutoff(lastSeenAt, now);
  const [rows, total] = await Promise.all([
    prisma.finTransaction.findMany({
      where: where(jarId, viewerId, today, cutoff),
      orderBy: [{ createdAt: "desc" }, { postedOn: "desc" }],
      take: NEW_SINCE_MAX,
      select: { id: true, postedOn: true, amountCents: true, merchantName: true, payee: true, description: true, categoryId: true, categorySource: true, account: { select: { currency: true } } },
    }),
    prisma.finTransaction.count({ where: where(jarId, viewerId, today, cutoff) }),
  ]);
  return {
    total,
    /** When this was read: the form sends it back, so "seen" never covers a charge that arrived after. */
    asOf: now.getTime(),
    rows: rows.map((r) => ({
      id: r.id,
      postedOn: r.postedOn,
      amountCents: r.amountCents,
      currency: r.account.currency,
      name: r.merchantName ?? tidyMerchantName(r.payee ?? r.description),
      categoryId: r.categoryId,
      categorySource: r.categorySource,
    })),
  };
}

/** The ids a "file them" form may touch: this jar's, still new to this viewer, active, not pending. */
export async function fileableIds(jarId: string, viewerId: string, lastSeenAt: Date | null, today: string, ids: string[], now: Date = new Date()) {
  if (ids.length === 0) return [];
  return prisma.finTransaction.findMany({
    where: { ...where(jarId, viewerId, today, newSinceCutoff(lastSeenAt, now)), id: { in: ids } },
    select: { id: true, categoryId: true, categorySource: true },
  });
}

/**
 * What saving does to one row. Pure. A category picked that differs is the member's pick
 * (PERSON); an unchanged guess (AUTO) is confirmed as theirs (PERSON); a rule's (RULE) or a
 * person's (PERSON) unchanged row is left alone, so it stays tied to its rule.
 */
export function filingFor(row: { categoryId: string | null; categorySource: string | null }, picked: string | null): { categoryId: string | null } | null {
  if (picked !== row.categoryId) return { categoryId: picked };
  if (row.categorySource === "AUTO") return { categoryId: picked };
  return null;
}
