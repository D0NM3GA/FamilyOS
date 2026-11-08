import { toCsv, csvMoney } from "@/lib/csv";
import type { BudgetCategory, BudgetRow } from "./budget";
import { spendingTrend } from "./trends";

/**
 * Phase 70e: a calendar year in one page, for taxes: spending by category, what isn't in a category
 * yet, surprises (a total only, as on Budget) and income. Every number is the sum of the Budget
 * page's months (lib/finance/trends.ts), so they agree. Pure.
 */

export type YearLine = { category: BudgetCategory; spentCents: number; byMonth: number[] };
export type YearSummary = {
  year: number;
  months: string[];
  lines: YearLine[];
  spentCents: number;
  uncategorizedOutCents: number;
  surprisesCents: number;
  incomeCents: number;
  /** Rows the year was made from (the jar's history counts a download by them). */
  rowCount: number;
};

/** The months of `year` to count: all twelve, or through this month for the year in progress. */
export function yearMonths(year: number, today: string): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= current);
}

/** The year asked for (2000 to this one), else this one. */
export function parseYear(raw: unknown, today: string): number {
  const now = Number(today.slice(0, 4));
  const n = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : now;
  return n >= 2000 && n <= now ? n : now;
}

export function yearSummary(rows: BudgetRow[], categories: BudgetCategory[], year: number, today: string): YearSummary {
  const months = yearMonths(year, today);
  const trend = spendingTrend(rows, categories, months, today);
  const lines = trend.categories
    .map((c) => ({ category: c.category, byMonth: c.byMonth, spentCents: c.byMonth.reduce((n, v) => n + v, 0) }))
    .filter((l) => l.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents);
  const sum = (pick: (m: (typeof trend.months)[number]) => number) => trend.months.reduce((n, m) => n + pick(m), 0);
  return {
    year,
    months,
    lines,
    spentCents: sum((m) => m.spentCents),
    uncategorizedOutCents: sum((m) => m.uncategorizedOutCents),
    surprisesCents: sum((m) => m.surprisesCents),
    incomeCents: sum((m) => m.incomeCents),
    rowCount: rows.filter((r) => months.includes(r.postedOn.slice(0, 7))).length,
  };
}

type CsvRow = { name: string; cents: number; byMonth: (number | null)[] };

/** The year as a spreadsheet: a row per category with each month, then the totals. */
export function yearCsv(s: YearSummary): string {
  const monthCols = Array.from({ length: 12 }, (_, i) => i);
  const pad = (byMonth: number[]) => monthCols.map((i) => (i < byMonth.length ? byMonth[i] : null));
  const rows: CsvRow[] = [
    ...s.lines.map((l) => ({ name: `${l.category.emoji ? `${l.category.emoji} ` : ""}${l.category.name}`, cents: l.spentCents, byMonth: pad(l.byMonth) })),
    ...(s.uncategorizedOutCents > 0 ? [{ name: "Not in a category", cents: s.uncategorizedOutCents, byMonth: monthCols.map(() => null) }] : []),
    ...(s.surprisesCents > 0 ? [{ name: "Surprises", cents: s.surprisesCents, byMonth: monthCols.map(() => null) }] : []),
    { name: "Income", cents: s.incomeCents, byMonth: monthCols.map(() => null) },
  ];
  const monthName = (i: number) => new Date(Date.UTC(s.year, i, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return toCsv<CsvRow>(
    [
      { header: "Category", value: (r) => r.name, freeText: true },
      { header: `Total ${s.year}`, value: (r) => csvMoney(r.cents) },
      ...monthCols.map((i) => ({ header: monthName(i), value: (r: CsvRow) => csvMoney(r.byMonth[i]) })),
    ],
    rows,
  );
}
