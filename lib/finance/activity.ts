import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { csvMoney, toCsv, type CsvColumn } from "@/lib/csv";
import { monthRange, parseMonth, shiftMonth } from "./budget";
import { visibleToWhere } from "./gifts";

/**
 * A jar's Activity list and its spreadsheet. One calendar month at a time (UTC months, like the
 * Budget's), newest first, stepping "← Older" / "Newer →" a month; this month unless the link
 * says otherwise. Optional filters: one account, one category (or "none": uncategorized).
 *
 * Surprises hidden from the viewer are never listed or exported (visibleToWhere), the same as
 * everywhere else in the jar. Ids from the URL are only ever ANDed with the jar's own id, so a
 * foreign account or category id finds nothing.
 */

/** Rows shown for one month, at most: past a busy family month; the page says when it's hit. */
export const ACTIVITY_MONTH_LIMIT = 300;

export type ActivityFilters = {
  /** "YYYY-MM". */
  month: string;
  account: string | null;
  /** A category id, or "none" for uncategorized. */
  category: string | null;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const idOf = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

/** The page's ?month=&account=&category=. The month defaults to this one; a future or junk month is this one too. */
export function activityFilters(sp: { month?: unknown; account?: unknown; category?: unknown }, today: string): ActivityFilters {
  const current = today.slice(0, 7);
  return {
    month: parseMonth(sp.month, current) ?? current,
    account: idOf(sp.account),
    category: sp.category === "none" ? "none" : idOf(sp.category),
  };
}

/** A link to the jar's Activity with these filters. */
export function activityHref(jarId: string, f: Partial<ActivityFilters>): string {
  const q = new URLSearchParams();
  if (f.account) q.set("account", f.account);
  if (f.category) q.set("category", f.category);
  if (f.month) q.set("month", f.month);
  const s = q.toString();
  return `/finances/${jarId}${s ? `?${s}` : ""}`;
}

/** The months either side to step to: nothing newer than this month, nothing before 2000. */
export function monthSteps(month: string, today: string): { older: string | null; newer: string | null } {
  return {
    older: month > "2000-01" ? shiftMonth(month, -1) : null,
    newer: month < today.slice(0, 7) ? shiftMonth(month, 1) : null,
  };
}

/**
 * The rows the viewer may see in this jar under these filters (a null month: every month).
 * `leftOut` also lists the rows of accounts left out of the jar (IGNORED, Phase 53): the page
 * shows them, marked; the spreadsheet and the counts behind totals don't.
 */
export function activityWhere(
  jarId: string,
  viewerId: string,
  today: string,
  f: { month: string | null; account?: string | null; category?: string | null; leftOut?: boolean },
): Prisma.FinTransactionWhereInput {
  return {
    jarId,
    state: f.leftOut ? { in: ["ACTIVE", "IGNORED"] } : "ACTIVE",
    ...visibleToWhere(viewerId, today),
    ...(f.account ? { accountId: f.account } : {}),
    ...(f.category === "none" ? { categoryId: null } : f.category ? { categoryId: f.category } : {}),
    ...(f.month ? { postedOn: monthRange(f.month) } : {}),
  };
}

// ---- the spreadsheet -----------------------------------------------------------------------

export type ActivityCsvRow = {
  postedOn: Date;
  amountCents: number;
  description: string;
  payee: string | null;
  merchantName: string | null;
  memo: string | null;
  privacyCardMemo: string | null;
  pending: boolean;
  account: { name: string; currency: string };
  category: { name: string } | null;
};

/**
 * Bank text and names are other people's words (a merchant can call itself "=HYPERLINK(…)"),
 * so every text column gets lib/csv.ts's formula guard. Amounts are signed: money out is
 * negative, as on the page. Days are the bank's civil days (stored as UTC midnight).
 */
export const ACTIVITY_CSV_COLUMNS: CsvColumn<ActivityCsvRow>[] = [
  { header: "Date", value: (r) => r.postedOn.toISOString().slice(0, 10) },
  { header: "Name", value: (r) => r.merchantName ?? r.payee ?? r.description, freeText: true },
  { header: "Bank description", value: (r) => r.description, freeText: true },
  { header: "Amount", value: (r) => csvMoney(r.amountCents) },
  { header: "Currency", value: (r) => r.account.currency, freeText: true },
  { header: "Account", value: (r) => r.account.name, freeText: true },
  { header: "Category", value: (r) => r.category?.name ?? "", freeText: true },
  { header: "Pending", value: (r) => (r.pending ? "yes" : "") },
  { header: "Card nickname", value: (r) => r.privacyCardMemo, freeText: true },
  { header: "Memo", value: (r) => r.memo, freeText: true },
];

/** The export form's choice: a month up to this one, or "all" (null). Anything else is refused. */
export function exportMonth(raw: unknown, today: string): { ok: true; month: string | null } | { ok: false } {
  if (raw === "all") return { ok: true, month: null };
  const month = parseMonth(raw, today.slice(0, 7));
  return month ? { ok: true, month } : { ok: false };
}

/** Built by our own code only (never the jar's name): it goes in a Content-Disposition header. */
export function activityCsvName(month: string | null, today: string): string {
  return month ? `money-activity-${month}.csv` : `money-activity-all-${today}.csv`;
}

/** The jar's activity as the viewer may see it, oldest first, as CSV text. Callers have passed requireJar. */
export async function activityCsv(jarId: string, viewerId: string, today: string, month: string | null): Promise<{ csv: string; count: number }> {
  const rows = await prisma.finTransaction.findMany({
    where: activityWhere(jarId, viewerId, today, { month }),
    orderBy: [{ postedOn: "asc" }, { createdAt: "asc" }],
    select: {
      postedOn: true,
      amountCents: true,
      description: true,
      payee: true,
      merchantName: true,
      memo: true,
      privacyCardMemo: true,
      pending: true,
      account: { select: { name: true, currency: true } },
      category: { select: { name: true } },
    },
  });
  return { csv: toCsv(ACTIVITY_CSV_COLUMNS, rows), count: rows.length };
}
