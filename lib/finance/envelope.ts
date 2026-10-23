import { shiftMonth, type BudgetCategory, type BudgetRow } from "./budget";

/**
 * Phase 31: saving up (sinking funds), pure. A rollover category keeps what it didn't spend:
 * each month since `rolloverFrom` adds (monthly budget − spent), and overspending carries too.
 * The carry uses today's monthly budget for every month (no budget history is kept), so
 * changing the budget recomputes it; the Budget page says so. At most 24 months count.
 */

export const MAX_CARRY_MONTHS = 24;

/** The months that carry into `month`: from `from` (or 24 months back) up to the month before. */
export function carryMonths(from: string | null, month: string): string[] {
  if (!from || from >= month) return [];
  const floor = shiftMonth(month, -MAX_CARRY_MONTHS);
  const out: string[] = [];
  for (let m = from > floor ? from : floor; m < month; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** What rolls into `month`: Σ (budget − spent) over the carry months. Spent is net money out. */
export function carryIn(from: string | null, month: string, budgetCents: number | null, spentByMonth: Map<string, number>): number {
  return carryMonths(from, month).reduce((n, m) => n + (budgetCents ?? 0) - Math.max(0, spentByMonth.get(m) ?? 0), 0);
}

export type RolloverCategory = BudgetCategory & { rollover: boolean; rolloverFrom: string | null };

/**
 * The categories with each rollover one's carry into `month` filled in, from `rows` (the
 * rows this viewer may see: a surprise hidden from them carries nothing until it's revealed).
 * Spent per month is the same as the Budget's: money out net of refunds, transfers aside.
 */
export function withCarry(categories: RolloverCategory[], rows: BudgetRow[], month: string): BudgetCategory[] {
  const spent = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.surprise || !r.categoryId) continue;
    const m = r.postedOn.slice(0, 7);
    if (m >= month) continue;
    const byMonth = spent.get(r.categoryId) ?? new Map<string, number>();
    byMonth.set(m, (byMonth.get(m) ?? 0) - r.amountCents);
    spent.set(r.categoryId, byMonth);
  }
  // Months before rollover was turned on read as plain monthly budgets.
  return categories.map((c) =>
    c.rollover && c.kind === "SPEND" && c.rolloverFrom && c.rolloverFrom <= month
      ? { ...c, carryInCents: carryIn(c.rolloverFrom, month, c.budgetCents, spent.get(c.id) ?? new Map()) }
      : c,
  );
}

/** The first month a carry query needs rows from (null: no rollover category). */
export function carryStart(categories: { rollover: boolean; rolloverFrom: string | null }[], month: string): string | null {
  const froms = categories.filter((c) => c.rollover && c.rolloverFrom && c.rolloverFrom < month).map((c) => carryMonths(c.rolloverFrom, month)[0]);
  return froms.length ? froms.sort()[0] : null;
}

export type GoalPlan = {
  /** Months after this one before the goal month ends; 0 when the goal is this month or past. */
  monthsAfter: number;
  /** To put aside in each of those months (whole dollars up, so it's never short); 0 when reached. */
  perMonthCents: number;
  reached: boolean;
  remainingCents: number;
  past: boolean;
};

/**
 * "Need $400 by August": from what the category holds now (`balanceCents`: carry + this month's
 * budget − this month's spending), how much each later month must add.
 */
export function goalPlan(goalCents: number, goalMonth: string, balanceCents: number, month: string): GoalPlan {
  const remaining = Math.max(0, goalCents - balanceCents);
  const [gy, gm] = goalMonth.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  const diff = (gy - y) * 12 + (gm - m);
  const monthsAfter = Math.max(0, diff);
  if (remaining === 0) return { monthsAfter, perMonthCents: 0, reached: true, remainingCents: 0, past: diff < 0 };
  const per = monthsAfter > 0 ? Math.ceil(remaining / monthsAfter / 100) * 100 : remaining;
  return { monthsAfter, perMonthCents: per, reached: false, remainingCents: remaining, past: diff < 0 };
}
