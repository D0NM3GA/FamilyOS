/**
 * Phase 26: bills and subscriptions, found from the charges themselves. Pure.
 *
 * Rows group by `privacy:<cardToken>` when the bank row was paid with a Privacy.com card (a
 * card is made for one merchant, so it's the most reliable key there is), else by the stored
 * merchant key. A group is recurring with 3+ charges on distinct days whose typical gap
 * (median) is weekly (6-8 days), every two weeks (12-16), monthly (26-35) or quarterly
 * (84-98), with at least 70% of gaps in that band (with 3 charges: both gaps). Amounts can
 * vary (utilities): they're labelled "about" or "varies", never used to reject. Every
 * Privacy card counts as a subscription even with one charge. Same shape as
 * lib/groceries/pantry.ts's cadence maths.
 *
 * Phase 27: yearly (350-380 days) also counts from just 2 charges, but only when the amount
 * is steady and it looks like a bill (a Privacy card, or the Bills / Subscriptions
 * category), so two similar shopping trips a year apart aren't a "bill". The bank feed only
 * reaches back ~89 days, so yearly (and at first quarterly) bills need imported statements.
 *
 * Phase 31: a price change is flagged only when it's settled: the latest charges (two or more)
 * agree on a price (within $1 or 2%), the run of charges just before them (two or more) agreed
 * on another, and the move is more than $1 or 5%. So a utility that wobbles, or one odd
 * charge, never flags; a bill that went up last year and again now flags the new rise. Pending
 * charges don't count (their day can change when they clear).
 *
 * After a settled price change, the bill's amount (typicalCents, steady) is taken from the
 * charges at the new price, so Coming up, its total and Safe to spend use what it costs now.
 */

import { isCategoryKey, type CategoryKeys, type CategoryKind } from "./categories";

export type RecurringRow = {
  key: string;
  label: string;
  /** UTC civil day. */
  postedOn: string;
  amountCents: number;
  privacyCardToken: string | null;
  privacyCardMemo: string | null;
  category: RowCategory | null;
  pending?: boolean;
};

/**
 * What a row's category tells the bill finder and Safe to spend: its kind, and the starting
 * keys it answers to (its own and any removed into it, Phase 37), always checked through
 * lib/finance/categories.ts isCategoryKey.
 */
export type RowCategory = CategoryKeys & { kind: CategoryKind };

export type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export type Recurring = {
  key: string;
  label: string;
  /** The group's merchant key (for a Privacy card group, its rows' key): a clean name. */
  merchantKey: string;
  cadence: Cadence | null;
  typicalCents: number;
  steady: boolean;
  lastOn: string;
  nextOn: string | null;
  count: number;
  isSubscription: boolean;
  cardMemo: string | null;
  /** The expected charge is overdue past the cadence's grace: it may have stopped. */
  stopped: boolean;
  /** Phase 31: the price moved and stayed moved; sinceOn is the first charge at the new price. */
  priceChange: PriceChange | null;
  /** Phase 32: the last three amounts (money out, positive), oldest first. */
  recentCents: number[];
};

/** sinceOn: the first charge at the new price; confirmedOn: the second (when it became sure). */
export type PriceChange = { fromCents: number; toCents: number; sinceOn: string; confirmedOn: string };

/** [cadence, shortest gap, longest gap, fewest charges, days late before "may have stopped"]. */
const BANDS: [Cadence, number, number, number, number][] = [
  ["WEEKLY", 6, 8, 3, 3],
  ["BIWEEKLY", 12, 16, 3, 5],
  ["MONTHLY", 26, 35, 3, 7],
  ["QUARTERLY", 84, 98, 3, 14],
  ["YEARLY", 350, 380, 2, 21],
];
const BILL_CATEGORIES = ["bills", "subscriptions"];

/** How far back to look for bills (Bills page and alerts): two years, so yearly ones show. */
export const RECURRING_WINDOW_DAYS = 800;

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The same day of the month, `n` months on (the 31st becomes the month's last day). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return toDay(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, dim)));
}
const MONTHS: Partial<Record<Cadence, number>> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const close = (a: number, b: number, pct: number) => Math.abs(a - b) <= Math.max(100, Math.round(Math.max(a, b) * pct));

/** The run of charges ending at `end` (inclusive) that agree with the one at `end`. */
function runBefore(sorted: { cents: number }[], end: number): number {
  let start = end;
  while (start > 0 && close(sorted[start - 1].cents, sorted[end].cents, 0.02)) start--;
  return start;
}

/** Charges in any order (money out as positive cents). Needs two at the old price and two at the new. */
export function priceChangeOf(charges: { postedOn: string; cents: number }[]): PriceChange | null {
  if (charges.length < 4) return null;
  const sorted = [...charges].sort((a, b) => a.postedOn.localeCompare(b.postedOn));
  const newStart = runBefore(sorted, sorted.length - 1);
  if (sorted.length - newStart < 2 || newStart < 2) return null;
  const oldStart = runBefore(sorted, newStart - 1);
  if (newStart - oldStart < 2) return null;
  const was = Math.round(median(sorted.slice(oldStart, newStart).map((c) => c.cents)));
  const now = sorted[sorted.length - 1].cents;
  if (close(now, was, 0.05)) return null;
  return { fromCents: was, toCents: now, sinceOn: sorted[newStart].postedOn, confirmedOn: sorted[newStart + 1].postedOn };
}

/**
 * `today` (a civil day) decides `stopped`; without it nothing is stopped. Transfers (card
 * payments, savings sweeps) aren't bills, so they're left out unless `includeTransfers`
 * (Phase 32's Safe to spend: a card autopay does leave checking).
 */
export function findRecurring(rows: RecurringRow[], today: string | null = null, opts: { includeTransfers?: boolean } = {}): Recurring[] {
  const groups = new Map<string, RecurringRow[]>();
  for (const r of rows) {
    if (r.amountCents >= 0 || (r.category?.kind === "TRANSFER" && !opts.includeTransfers)) continue;
    const key = groupKeyOf(r);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const days = [...new Set(list.map((r) => r.postedOn))].sort();
    const amounts = list.map((r) => -r.amountCents);
    const typical = Math.round(median(amounts));
    const steady = amounts.every((a) => Math.abs(a - typical) <= Math.max(200, typical * 0.2));
    const privacy = list.find((r) => r.privacyCardToken);
    const isSubscription = Boolean(privacy) || list.some((r) => r.privacyCardMemo != null || isCategoryKey(r.category, "subscriptions"));

    const looksLikeBill = Boolean(privacy) || list.some((r) => BILL_CATEGORIES.some((k) => isCategoryKey(r.category, k)));
    let cadence: Cadence | null = null;
    let grace = 0;
    let gap = 0;
    if (days.length >= 2) {
      const gaps = days.slice(1).map((d, i) => Math.round((toMs(d) - toMs(days[i])) / DAY));
      gap = median(gaps);
      // Bands don't overlap, so at most one matches.
      for (const [name, lo, hi, fewest, late] of BANDS) {
        if (days.length < fewest || gap < lo || gap > hi) continue;
        if (days.length === 2 && !(steady && looksLikeBill)) continue;
        if (gaps.filter((g) => g >= lo && g <= hi).length / gaps.length >= 0.7) {
          cadence = name;
          grace = late;
        }
      }
    }
    if (!cadence && !privacy) continue;

    const lastOn = days[days.length - 1];
    const priceChange = cadence ? priceChangeOf(list.filter((r) => !r.pending).map((r) => ({ postedOn: r.postedOn, cents: -r.amountCents }))) : null;
    // Once a new price has settled, it's the price: what's shown, what Coming up adds up and
    // what Safe to spend plans for come from the charges since it, not the whole history
    // (whose median was still the old price).
    const nowAmounts = priceChange ? list.filter((r) => r.postedOn >= priceChange.sinceOn).map((r) => -r.amountCents) : amounts;
    const nowTypical = Math.round(median(nowAmounts));
    const nowSteady = nowAmounts.every((a) => Math.abs(a - nowTypical) <= Math.max(200, nowTypical * 0.2));
    // Phase 32: monthly and slower bills come back on the same day of the month.
    const nextOn = cadence ? (MONTHS[cadence] ? addMonths(lastOn, MONTHS[cadence]!) : toDay(toMs(lastOn) + Math.round(gap) * DAY)) : null;
    out.push({
      key,
      label: privacy?.privacyCardMemo || list[list.length - 1].label,
      merchantKey: list[list.length - 1].key,
      cadence,
      typicalCents: nowTypical,
      steady: nowSteady,
      lastOn,
      nextOn,
      count: days.length,
      isSubscription,
      cardMemo: privacy?.privacyCardMemo ?? null,
      stopped: nextOn != null && today != null && daysBetween(nextOn, today) > grace,
      priceChange,
      recentCents: [...list]
        .sort((a, b) => a.postedOn.localeCompare(b.postedOn))
        .slice(-3)
        .map((r) => -r.amountCents),
    });
  }
  return out.sort((a, b) => (a.nextOn ?? "9999").localeCompare(b.nextOn ?? "9999") || a.label.localeCompare(b.label));
}

/**
 * Bills worth a heads-up: monthly or slower, or a subscription with a rhythm. Weekly and
 * every-two-weeks shops (the grocery store) would ping every week, so they don't.
 */
export function isRegularBill(r: Recurring): boolean {
  if (!r.cadence || r.stopped || !r.nextOn) return false;
  return r.cadence === "MONTHLY" || r.cadence === "QUARTERLY" || r.cadence === "YEARLY" || r.isSubscription;
}

export type ComingUp = { items: (Recurring & { cancelling: boolean })[]; totalCents: number };

/** A bill this many days late or less still counts (Coming up, Safe to spend); later than that it's let go. */
export const LATE_DAYS = 3;

/** The group a row's charge belongs to: its Privacy card when it has one, else its merchant. */
export const groupKeyOf = (r: Pick<RecurringRow, "key" | "privacyCardToken">) => (r.privacyCardToken ? `privacy:${r.privacyCardToken}` : r.key);

/** A paper check (or a bank draft) in the feed: "CHECK 1042", "CHK 88". */
export const isCheckKey = (key: string) => /^(check|cheque|chk|ck|draft)\b/.test(key);

/**
 * Phase 32: was a bill of about `cents`, due on `due`, already paid? Yes when a charge of about
 * its size (within 25%) left since a few days before it was due, from the bill's own group
 * (`own`) or from nothing regular: a pending charge worded differently from the posted one, a
 * check. Another regular bill's charge doesn't pay this one. `regular` is every found bill's key.
 *
 * A bill added by hand (`handAdded`) is stricter: only its own merchant or a check pays it.
 * Otherwise any one-off purchase of about its size (a $460 trip to the hardware store against
 * $500 of school fees) marked it paid, and Safe to spend erred high.
 */
export function paidCheck(rows: RecurringRow[], regular: Set<string>, today: string) {
  const outs = rows.filter((r) => r.amountCents < 0);
  const from = (due: string) => new Date(Date.parse(`${due}T00:00:00Z`) - LATE_DAYS * DAY).toISOString().slice(0, 10);
  return (own: string[], due: string, cents: number, handAdded = false) =>
    outs.some((r) => {
      const g = groupKeyOf(r);
      const from_ = own.includes(g) || (handAdded ? isCheckKey(g) : !regular.has(g));
      return from_ && r.postedOn >= from(due) && r.postedOn <= today && Math.abs(-r.amountCents - cents) <= cents * 0.25;
    });
}
export type PaidCheck = ReturnType<typeof paidCheck>;

/**
 * Phase 31: regular bills expected from 3 days ago (late ones) through the next `days`, in
 * order, with about how much they add up to. One per bill: a weekly subscription shows once.
 * Bills answered "Not a bill" are left out; "Cancel it" ones are flagged (and still counted:
 * they'll charge until they're cancelled).
 */
export function comingUp(found: Recurring[], statusOf: Map<string, string>, today: string, days = 30): ComingUp {
  const items = found
    .filter((r) => isRegularBill(r) && statusOf.get(r.key) !== "HIDDEN")
    .filter((r) => {
      const until = daysBetween(today, r.nextOn!);
      return until >= -LATE_DAYS && until <= days;
    })
    .map((r) => ({ ...r, cancelling: statusOf.get(r.key) === "CANCEL" }))
    .sort((a, b) => a.nextOn!.localeCompare(b.nextOn!) || a.label.localeCompare(b.label));
  return { items, totalCents: items.reduce((n, r) => n + r.typicalCents, 0) };
}

/** Days between two civil days (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY);
}
