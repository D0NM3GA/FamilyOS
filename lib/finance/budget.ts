/**
 * Phase 26: the monthly budget, pure. Money rows carry UTC civil days (`postedOn`), so months
 * are UTC calendar months and "today" is the server's local civil day as YYYY-MM-DD, compared
 * as strings. Spending = money out in SPEND categories, net of refunds in the same category;
 * pending rows count (a superseded pending row is no longer ACTIVE, so nothing doubles).
 * Transfers never count; income is only rows in the income category.
 *
 * Phase 27: a surprise hidden from the viewer (lib/finance/gifts.ts) skips every bucket and
 * lands only in the Surprises total, which still counts toward Spent, so totals stay whole.
 *
 * Phase 31: a rollover category brings in what earlier months left (`carryInCents`, from
 * lib/finance/envelope.ts); it is over when this month's spending passes budget + carry (or
 * anything is spent once the carry has gone below zero).
 */

export type BudgetRow = { amountCents: number; postedOn: string; pending: boolean; categoryId: string | null; surprise?: boolean };
export type BudgetCategory = { id: string; key: string; name: string; emoji: string | null; kind: "SPEND" | "INCOME" | "TRANSFER"; budgetCents: number | null; carryInCents?: number };

export type BudgetLine = {
  category: BudgetCategory;
  spentCents: number;
  pendingCents: number;
  budgetCents: number | null;
  /** Rollover categories only: carried in from earlier months, and budget + carry. */
  carryInCents: number | null;
  availableCents: number | null;
  status: "ON_TRACK" | "OVER" | null;
};

export type BudgetSummary = {
  month: string;
  lines: BudgetLine[];
  spentCents: number;
  budgetedCents: number;
  incomeCents: number;
  uncategorizedOutCents: number;
  /** Surprises hidden from the viewer: net money out, and how many rows. */
  surprisesCents: number;
  surpriseCount: number;
  /** 0..1 of the month gone; 1 for past months, 0 for future ones. */
  monthGone: number;
};

/** Server-local civil day, e.g. "2026-10-05". */
export function todayCivil(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2026-10" → its UTC bounds, for a `postedOn` query. */
export function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/** A `?month=` value as "YYYY-MM" from 2000-01 up to `max` (this month), or null. */
export function parseMonth(asked: unknown, max: string): string | null {
  return typeof asked === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked >= "2000-01" && asked <= max ? asked : null;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthGone(month: string, today: string): number {
  const current = today.slice(0, 7);
  if (month < current) return 1;
  if (month > current) return 0;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(today.slice(8, 10)) / days;
}

export function budgetMonth(rows: BudgetRow[], categories: BudgetCategory[], month: string, today: string): BudgetSummary {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const spent = new Map<string, number>();
  const pending = new Map<string, number>();
  let incomeCents = 0;
  let uncategorizedOutCents = 0;
  let surprisesCents = 0;
  let surpriseCount = 0;

  for (const r of rows) {
    if (r.postedOn.slice(0, 7) !== month) continue;
    if (r.surprise) {
      surprisesCents -= r.amountCents;
      surpriseCount += 1;
      continue;
    }
    const cat = r.categoryId ? byId.get(r.categoryId) : undefined;
    if (!cat) {
      if (r.amountCents < 0) uncategorizedOutCents += -r.amountCents;
      continue;
    }
    if (cat.kind === "TRANSFER") continue;
    if (cat.kind === "INCOME") {
      incomeCents += r.amountCents;
      continue;
    }
    // Money out is spending; money in (a refund) takes it back.
    spent.set(cat.id, (spent.get(cat.id) ?? 0) - r.amountCents);
    if (r.pending && r.amountCents < 0) pending.set(cat.id, (pending.get(cat.id) ?? 0) - r.amountCents);
  }

  const gone = monthGone(month, today);
  const lines: BudgetLine[] = categories
    .filter((c) => c.kind === "SPEND")
    .map((c) => {
      const s = Math.max(0, spent.get(c.id) ?? 0);
      const carry = c.carryInCents ?? null;
      const available = carry == null ? c.budgetCents : (c.budgetCents ?? 0) + carry;
      return {
        category: c,
        spentCents: s,
        pendingCents: pending.get(c.id) ?? 0,
        budgetCents: c.budgetCents,
        carryInCents: carry,
        availableCents: carry == null ? null : available,
        status: available == null || gone === 0 ? null : s > Math.max(0, available) ? "OVER" : "ON_TRACK",
      };
    });

  return {
    month,
    lines,
    spentCents: lines.reduce((n, l) => n + l.spentCents, 0) + Math.max(0, surprisesCents),
    budgetedCents: lines.reduce((n, l) => n + (l.budgetCents ?? 0), 0),
    incomeCents,
    uncategorizedOutCents,
    surprisesCents: Math.max(0, surprisesCents),
    surpriseCount,
    monthGone: gone,
  };
}
