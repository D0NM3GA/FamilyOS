import { prisma } from "@/lib/prisma";
import { monthRange } from "./budget";
import { isHiddenFrom } from "./gifts";
import { yearMonths, yearSummary, type YearSummary } from "./year";

/**
 * Phase 70e: a jar's year, read the way Trends reads a month (US-dollar rows, every row fetched so a
 * surprise hidden from the viewer lands in the Surprises total and the totals stay whole).
 */
export async function loadYear(jarId: string, viewerId: string, year: number, today: string): Promise<YearSummary> {
  const months = yearMonths(year, today);
  const [categories, rows] = await Promise.all([
    prisma.finCategory.findMany({ where: { jarId }, orderBy: { sortOrder: "asc" }, select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true } }),
    months.length === 0
      ? Promise.resolve([])
      : prisma.finTransaction.findMany({
          where: { jarId, state: "ACTIVE", account: { currency: "USD" }, postedOn: { gte: monthRange(months[0]).gte, lt: monthRange(months[months.length - 1]).lt } },
          select: { amountCents: true, postedOn: true, pending: true, categoryId: true, giftHiddenFrom: true, giftRevealOn: true },
        }),
  ]);
  const shaped = rows.map((r) => ({
    amountCents: r.amountCents,
    pending: r.pending,
    categoryId: r.categoryId,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    surprise: isHiddenFrom(r, viewerId, today),
  }));
  return yearSummary(shaped, categories, year, today);
}
