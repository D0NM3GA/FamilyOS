import { budgetMonth, shiftMonth, type BudgetCategory, type BudgetRow, type BudgetSummary } from "./budget";

/**
 * Phase 33: spending over time, pure. Every month is lib/finance/budget.ts budgetMonth, so
 * each number is the one the Budget page shows for that month: US-dollar rows the caller
 * picked, pending counted, transfers out, income only in the income category, and a
 * surprise hidden from the viewer only in that month's Surprises total.
 *
 * Refunds net within a month. budgetMonth clamps a category's month at zero, so a refund
 * that lands the month after its purchase makes that month 0 (not negative) and leaves the
 * purchase month as it was.
 *
 * "Went out" adds what isn't in a category yet to Budget's Spent, so a month's bar is all
 * the money that left, whatever has been filed.
 *
 * Surprises stay month-sized: nothing here gives a hidden surprise a day (the "so far" pace
 * is categories only), which is no more than the Budget page already shows.
 */

export const TREND_MONTHS = 12;

export type TrendMonth = {
  month: string;
  /** Budget's Spent: categories + surprises. */
  spentCents: number;
  uncategorizedOutCents: number;
  /** Spent + not in a category. */
  outCents: number;
  incomeCents: number;
  surprisesCents: number;
  surpriseCount: number;
};

export type CategoryTrend = {
  category: BudgetCategory;
  /** Spent per month, lined up with the trend's months. */
  byMonth: number[];
};

export type SpendingTrend = { months: TrendMonth[]; categories: CategoryTrend[] };

/**
 * The months to show: the last 12 up to this month, or the 12 ending at `month` when it is
 * older than that (so tapping a bar never moves the bars, and old imported statements can
 * still be looked at).
 */
export function trendWindow(month: string, current: string): string[] {
  const end = month < shiftMonth(current, -(TREND_MONTHS - 1)) ? month : current;
  return Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(end, i - (TREND_MONTHS - 1)));
}

/**
 * Drops the leading months before the jar's first row (but never the month being looked at);
 * quiet months after that stay. Only for a jar with no rows before `months` (the caller
 * checks). `first` is the first month with a row, or null when there are none.
 */
export function trimLeading(months: string[], rows: Pick<BudgetRow, "postedOn">[], keep: string): { months: string[]; first: string | null } {
  let first: string | null = null;
  for (const r of rows) {
    const m = r.postedOn.slice(0, 7);
    if (months.includes(m) && (first == null || m < first)) first = m;
  }
  const from = first != null && first < keep ? first : keep;
  return { months: months.filter((m) => m >= from), first };
}

function byMonth(rows: BudgetRow[]): Map<string, BudgetRow[]> {
  const out = new Map<string, BudgetRow[]>();
  for (const r of rows) {
    const m = r.postedOn.slice(0, 7);
    const list = out.get(m);
    if (list) list.push(r);
    else out.set(m, [r]);
  }
  return out;
}

/** No carry here: trends are spending, not budget status. */
const plain = (categories: BudgetCategory[]) => categories.map((c) => ({ ...c, carryInCents: undefined }));

function trendMonth(s: BudgetSummary): TrendMonth {
  return {
    month: s.month,
    spentCents: s.spentCents,
    uncategorizedOutCents: s.uncategorizedOutCents,
    outCents: s.spentCents + s.uncategorizedOutCents,
    incomeCents: s.incomeCents,
    surprisesCents: s.surprisesCents,
    surpriseCount: s.surpriseCount,
  };
}

/** Each month's totals and each spending category's month-by-month line (categories with nothing in any month left out). */
export function spendingTrend(rows: BudgetRow[], categories: BudgetCategory[], months: string[], today: string): SpendingTrend {
  const cats = plain(categories);
  const grouped = byMonth(rows);
  const summaries = months.map((m) => budgetMonth(grouped.get(m) ?? [], cats, m, today));
  const lines = cats
    .filter((c) => c.kind === "SPEND")
    .map((c) => ({ category: c, byMonth: summaries.map((s) => s.lines.find((l) => l.category.id === c.id)?.spentCents ?? 0) }))
    .filter((t) => t.byMonth.some((n) => n > 0));
  return { months: summaries.map(trendMonth), categories: lines };
}

export type Change = { deltaCents: number; pct: number | null };

/** Up or down from before; pct is null when there was nothing before. */
export function monthChange(nowCents: number, beforeCents: number): Change {
  return { deltaCents: nowCents - beforeCents, pct: beforeCents > 0 ? (nowCents - beforeCents) / beforeCents : null };
}

/**
 * The month in progress against the same days of last month: each spending category's
 * spending last month up to today's day of the month (all of it when today's day is past
 * last month's end). Categories only: surprise rows are dropped before anything is added up.
 */
export function paceSoFar(rows: BudgetRow[], categories: BudgetCategory[], today: string): Map<string, number> {
  const prev = shiftMonth(today.slice(0, 7), -1);
  const day = today.slice(8, 10);
  const same = rows.filter((r) => !r.surprise && r.postedOn.slice(0, 7) === prev && r.postedOn.slice(8, 10) <= day);
  const s = budgetMonth(same, plain(categories), prev, today);
  return new Map(s.lines.map((l) => [l.category.id, l.spentCents]));
}

/**
 * What a month is compared with: the month before (whole), or for the month in progress the
 * same days of last month (`pace`: categories only, no uncategorized figure).
 */
export type Before = { byCategory: Map<string, number>; uncategorizedOutCents: number | null };

/** The whole month at `index` of a trend, as a "before". */
export function beforeFrom(trend: SpendingTrend, index: number): Before | null {
  const m = trend.months[index];
  if (!m) return null;
  return { byCategory: new Map(trend.categories.map((t) => [t.category.id, t.byMonth[index]])), uncategorizedOutCents: m.uncategorizedOutCents };
}

export function beforeFromPace(pace: Map<string, number>): Before {
  return { byCategory: pace, uncategorizedOutCents: null };
}

/**
 * The change shown under a row. A spending category (or one with nothing this month) against
 * its own before; "not in a category" only against a whole month; surprises never (a change
 * would say no more than the month totals, but there's no reason to point at them).
 */
export function changeFor(row: Slice | { kind: "quiet"; category: BudgetCategory }, before: Before | null): Change | null {
  if (!before) return null;
  if (row.kind === "category") return monthChange(row.cents, before.byCategory.get(row.category.id) ?? 0);
  if (row.kind === "quiet") return monthChange(0, before.byCategory.get(row.category.id) ?? 0);
  if (row.kind === "uncategorized" && before.uncategorizedOutCents != null) return monthChange(row.cents, before.uncategorizedOutCents);
  return null;
}

export type Slice =
  | { kind: "category"; category: BudgetCategory; cents: number; share: number }
  | { kind: "uncategorized"; cents: number; share: number }
  | { kind: "surprises"; cents: number; share: number; count: number };

/** Where a month's money went, biggest first; empty slices left out. Shares are of "went out". */
export function whereItWent(trend: SpendingTrend, index: number): Slice[] {
  const m = trend.months[index];
  if (!m) return [];
  const share = (c: number) => (m.outCents > 0 ? c / m.outCents : 0);
  const slices: Slice[] = trend.categories
    .filter((t) => t.byMonth[index] > 0)
    .map((t) => ({ kind: "category" as const, category: t.category, cents: t.byMonth[index], share: share(t.byMonth[index]) }));
  if (m.uncategorizedOutCents > 0) slices.push({ kind: "uncategorized", cents: m.uncategorizedOutCents, share: share(m.uncategorizedOutCents) });
  if (m.surprisesCents > 0) slices.push({ kind: "surprises", cents: m.surprisesCents, share: share(m.surprisesCents), count: m.surpriseCount });
  return slices.sort((a, b) => b.cents - a.cents);
}

/** Bunson's note: at least this much before, and at least this much (and 20%) less after. */
const LOWER_FLOOR_CENTS = 2500;
const LOWER_PCT = 0.2;

/**
 * The spending category that came in most below the month before, comparing the last two
 * whole months (never the month in progress). The first month shown is skipped as "before":
 * it's where the jar's rows start, so it may only be part of a month.
 */
export function lowerLastMonth(trend: SpendingTrend, current: string): BudgetCategory | null {
  const last = trend.months.findIndex((m) => m.month === shiftMonth(current, -1));
  if (last < 2) return null;
  let best: { category: BudgetCategory; drop: number } | null = null;
  for (const t of trend.categories) {
    const before = t.byMonth[last - 1];
    const after = t.byMonth[last];
    const drop = before - after;
    if (before < LOWER_FLOOR_CENTS || drop < LOWER_FLOOR_CENTS || drop < before * LOWER_PCT) continue;
    if (!best || drop > best.drop) best = { category: t.category, drop };
  }
  return best?.category ?? null;
}
