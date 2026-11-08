import { prisma } from "@/lib/prisma";
import { budgetMonth, monthRange } from "./budget";
import { carryStart, withCarry, type RolloverCategory } from "./envelope";
import { isHiddenFrom } from "./gifts";

const ROW = { amountCents: true, postedOn: true, pending: true, categoryId: true, giftHiddenFrom: true, giftRevealOn: true } as const;

/**
 * Phase 70e: how many of a jar's budget lines are running ahead or over this month, the same way
 * the Budget page works them out (with what rollover categories carry in), for Money's home.
 * Surprises hidden from the viewer count as the Budget page counts them.
 */
export async function jarBudgetFlags(jarId: string, viewerId: string, today: string): Promise<{ ahead: number; over: number }> {
  const month = today.slice(0, 7);
  const categories = await prisma.finCategory.findMany({
    where: { jarId, kind: "SPEND", budgetCents: { not: null } },
    select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true, rollover: true, rolloverFrom: true },
  });
  if (categories.length === 0) return { ahead: 0, over: 0 };
  const from = carryStart(categories, month);
  const rolling = categories.filter((c) => c.rollover).map((c) => c.id);
  const usd = { account: { currency: "USD" } };
  const [rows, carryRows] = await Promise.all([
    prisma.finTransaction.findMany({ where: { jarId, state: "ACTIVE", postedOn: monthRange(month), ...usd }, select: ROW }),
    from
      ? prisma.finTransaction.findMany({ where: { jarId, state: "ACTIVE", categoryId: { in: rolling }, postedOn: { gte: monthRange(from).gte, lt: monthRange(month).gte }, ...usd }, select: ROW })
      : Promise.resolve([]),
  ]);
  const shape = (r: (typeof rows)[number]) => ({
    amountCents: r.amountCents,
    pending: r.pending,
    categoryId: r.categoryId,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    surprise: isHiddenFrom(r, viewerId, today),
  });
  const summary = budgetMonth(rows.map(shape), withCarry(categories as RolloverCategory[], carryRows.map(shape), month), month, today);
  return {
    ahead: summary.lines.filter((l) => l.status === "AHEAD").length,
    over: summary.lines.filter((l) => l.status === "OVER").length,
  };
}
