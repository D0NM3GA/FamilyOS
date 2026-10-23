import { daysBetween, findRecurring, LATE_DAYS, paidCheck, type Recurring, type RecurringRow } from "./recurring";
import type { CategoryKind } from "./categories";
import { nextDueOn, ownKeys, standsFor, type ManualBillInput } from "./manual-bills";

/**
 * Phase 32: Safe to spend, pure. From the balances of the jar's spending accounts (checking,
 * picked in Settings) and the regular money leaving those same accounts (bills, card autopay,
 * savings sweeps), how low the balance gets before the next payday, and what's left after the
 * jar's cushion. Simple and explainable: every number on the page comes from a listed line.
 *
 * - Paydays are regular money in, on the spending accounts, in an income category (the built-in
 *   Income or one the family added) or Transfers (a paycheck often lands as a transfer), from a source that never takes money out (a refund isn't pay),
 *   and big enough to be pay (at least $200 and a quarter of the biggest one). Every two weeks
 *   is pay on a fixed 14-day grid (a holiday moves it a day at most; one extra deposit, a
 *   bonus, is allowed); the 1st-and-15th kind is found by day of month (weekend shifts and
 *   month ends included; it needs two deposits on each day); weekly and monthly by the gap
 *   between deposits.
 * - A bill due today or a few days late counts today, unless a charge of about its size (within
 *   25%) already left the account since it was due, from that bill or from nothing regular (a
 *   pending charge whose text differs from the posted one would otherwise be counted twice: the
 *   bank's available balance already has it).
 * - Amounts: a steady bill's usual amount; a varying one (a card's statement balance) its
 *   biggest of the last three, so the number errs low.
 * - Same-day order: money out first (it errs low too). The payday itself isn't added: the
 *   lowest point is before it.
 * - Bills added by hand (lib/finance/manual-bills.ts) count like found monthly ones, leaving
 *   checking; a found bill one of them stands for isn't counted again.
 */

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toDay(toMs(d) + n * DAY);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const median = (nums: number[]) => {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** How far ahead to look when no payday is found. */
export const NO_PAYDAY_DAYS = 14;
/** A payday this many days late still counts as today; later, it's treated as stopped. */
const PAYDAY_LATE_DAYS = 3;
const PAY_FLOOR_CENTS = 20_000;

export type PayCadence = "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";
export type Payday = { key: string; label: string; cadence: PayCadence; typicalCents: number; lastOn: string; nextOn: string };
export type PayRow = { key: string; label: string; postedOn: string; amountCents: number; category: { kind: CategoryKind } | null };

/** Day of month, with the 28th onward read as 0, -1, … from the month's end (so "the 1st, or the Friday before it" is one group). */
function domValue(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const dim = daysIn(y, m);
  return d >= 28 ? d - dim : d;
}

/** The civil day for a day-of-month value in a month (0 = the last day). */
function dayFor(y: number, m: number, value: number): string {
  const dim = daysIn(y, m);
  const d = value >= 1 ? Math.min(value, dim) : dim + value;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The next day that falls on one of these day-of-month values, at least 5 days after `after`:
 * a paycheck moved early for a weekend (Fri the 30th for the 1st) has already paid that period.
 */
function nextByDom(after: string, values: number[]): string {
  let [y, m] = after.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    for (const v of values) out.push(dayFor(y, m, v));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.filter((d) => daysBetween(after, d) > 4).sort()[0];
}

/** Values within 4 days of each other, split at the widest gap into at most two groups. */
function domGroups(values: number[]): number[][] | null {
  const s = [...values].sort((a, b) => a - b);
  if (s[s.length - 1] - s[0] <= 4) return [s];
  let cut = 1;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > s[cut] - s[cut - 1]) cut = i;
  const groups = [s.slice(0, cut), s.slice(cut)];
  return groups.every((g) => g.length >= 2 && g[g.length - 1] - g[0] <= 4) && groups[1][0] - groups[0][groups[0].length - 1] >= 8 ? groups : null;
}

/**
 * Every two weeks: the deposits sit on a 14-day grid (a holiday moves one a day at most),
 * counted from one of the last two (so one extra deposit, a bonus, doesn't break it).
 * Returns the latest deposit on the grid, or null.
 */
function biweeklyLast(days: string[]): string | null {
  for (const anchor of days.slice(-2).reverse()) {
    const on = days.filter((d) => {
      const off = (toMs(anchor) - toMs(d)) / DAY;
      return Math.abs(off - 14 * Math.round(off / 14)) <= 1;
    });
    if (on.length >= 3 && days.length - on.length <= 1) return on[on.length - 1];
  }
  return null;
}

function cadenceOf(days: string[]): { cadence: PayCadence; next: (last: string) => string } | null {
  const grid = days.length >= 3 ? biweeklyLast(days) : null;
  // The extra deposit may be the latest: count from the last one on the grid.
  if (grid) return { cadence: "BIWEEKLY", next: () => addDays(grid, 14) };
  const gaps = days.slice(1).map((d, i) => Math.round((toMs(d) - toMs(days[i])) / DAY));
  const gap = median(gaps);
  const share = (lo: number, hi: number) => gaps.filter((g) => g >= lo && g <= hi).length / gaps.length;
  if (gap >= 6 && gap <= 8 && share(6, 8) >= 0.7) return { cadence: "WEEKLY", next: (l) => addDays(l, 7) };
  if (gap >= 12 && gap <= 19) {
    // The 1st and 15th needs two deposits on each day to be told apart from every two weeks.
    const groups = domGroups(days.map(domValue));
    if (groups?.length === 2) {
      const centers = groups.map((g) => Math.round(median(g)));
      return { cadence: "SEMIMONTHLY", next: (l) => nextByDom(l, centers) };
    }
  }
  if (gap >= 26 && gap <= 35 && share(26, 35) >= 0.7) {
    const groups = domGroups(days.map(domValue));
    const center = groups?.length === 1 ? Math.round(median(groups[0])) : domValue(days[days.length - 1]);
    return { cadence: "MONTHLY", next: (l) => nextByDom(l, [center]) };
  }
  return null;
}

/** Regular pay, soonest first. `rows` are the spending accounts' rows (money in and out). */
export function findPaydays(rows: PayRow[], today: string): Payday[] {
  const takesMoney = new Set(rows.filter((r) => r.amountCents < 0 && r.key).map((r) => r.key));
  const groups = new Map<string, Map<string, { cents: number; label: string }>>();
  for (const r of rows) {
    if (r.amountCents <= 0 || !r.key || takesMoney.has(r.key)) continue;
    // Any income category (Phase 37: a family's own, like "Side gig", too), or Transfers.
    if (r.category?.kind !== "INCOME" && r.category?.kind !== "TRANSFER") continue;
    const byDay = groups.get(r.key) ?? new Map<string, { cents: number; label: string }>();
    const day = byDay.get(r.postedOn);
    byDay.set(r.postedOn, { cents: (day?.cents ?? 0) + r.amountCents, label: r.label });
    groups.set(r.key, byDay);
  }
  const found: Payday[] = [];
  for (const [key, byDay] of groups) {
    const days = [...byDay.keys()].sort();
    if (days.length < 3) continue;
    const c = cadenceOf(days);
    if (!c) continue;
    const lastOn = days[days.length - 1];
    let nextOn = c.next(lastOn);
    if (!nextOn) continue;
    if (nextOn < today) {
      if (daysBetween(nextOn, today) > PAYDAY_LATE_DAYS) continue;
      nextOn = today;
    }
    found.push({ key, label: byDay.get(lastOn)!.label, cadence: c.cadence, typicalCents: Math.round(median([...byDay.values()].map((v) => v.cents))), lastOn, nextOn });
  }
  const biggest = Math.max(0, ...found.map((p) => p.typicalCents));
  return found.filter((p) => p.typicalCents >= Math.max(PAY_FLOOR_CENTS, biggest / 4)).sort((a, b) => a.nextOn.localeCompare(b.nextOn));
}

export type ForecastAccount = { id: string; name: string; spending: boolean; balanceCents: number | null; availableCents: number | null; balanceAt: Date | null };
export type ForecastRow = RecurringRow & { accountId: string };
export type ForecastEvent = {
  on: string;
  label: string;
  cents: number;
  runningCents: number;
  varies: boolean;
  late: boolean;
  /** A bill added by hand (✍️). */
  manual: boolean;
};

export type Forecast =
  | { ready: false; reason: "NO_ACCOUNTS" | "NO_BALANCE"; notCounted: string[] }
  | {
      ready: true;
      startCents: number;
      asOf: Date;
      payday: Payday | null;
      /** Last day looked at: the payday, or 14 days out. */
      until: string;
      events: ForecastEvent[];
      lowest: { cents: number; on: string; after: string | null };
      cushionCents: number;
      safeCents: number;
      counted: string[];
      notCounted: string[];
    };

const STEP: Partial<Record<NonNullable<Recurring["cadence"]>, number>> = { WEEKLY: 7, BIWEEKLY: 14 };

export function forecast(input: {
  accounts: ForecastAccount[];
  /** Every visible row in the window, on any account (filtered to spending accounts here). */
  rows: ForecastRow[];
  /** Bills page answers: "HIDDEN" (not a bill) is left out. */
  statusOf: Map<string, string>;
  today: string;
  cushionCents: number | null;
  /** Bills added by hand (lib/finance/manual-bills.ts): planned like found ones, never twice. */
  manualBills?: ManualBillInput[];
}): Forecast {
  const { today } = input;
  const spending = input.accounts.filter((a) => a.spending);
  const withBalance = spending.filter((a) => (a.availableCents ?? a.balanceCents) != null && a.balanceAt);
  const notCounted = input.accounts.filter((a) => !withBalance.includes(a)).map((a) => a.name);
  if (spending.length === 0) return { ready: false, reason: "NO_ACCOUNTS", notCounted };
  if (withBalance.length === 0) return { ready: false, reason: "NO_BALANCE", notCounted };

  const ids = new Set(withBalance.map((a) => a.id));
  const rows = input.rows.filter((r) => ids.has(r.accountId));
  const startCents = withBalance.reduce((n, a) => n + (a.availableCents ?? a.balanceCents)!, 0);
  const asOf = new Date(Math.min(...withBalance.map((a) => a.balanceAt!.getTime())));
  const payday = findPaydays(rows, today)[0] ?? null;
  const until = payday ? payday.nextOn : addDays(today, NO_PAYDAY_DAYS);

  const found = findRecurring(rows, today, { includeTransfers: true });
  const manual = input.manualBills ?? [];
  // A found bill that a hand-added one stands for is planned once, as the hand-added one.
  const replaced = standsFor(manual, found);
  const paidSince = paidCheck(rows, new Set(found.map((r) => r.key)), today);

  const planned: Omit<ForecastEvent, "runningCents">[] = [];
  for (const r of found) {
    if (!r.cadence || r.stopped || !r.nextOn || input.statusOf.get(r.key) === "HIDDEN" || replaced.has(r.key)) continue;
    const cents = r.steady ? r.typicalCents : Math.max(r.typicalCents, ...r.recentCents);
    const step = STEP[r.cadence];
    for (let due = r.nextOn; due <= until; due = addDays(due, step!)) {
      if (due <= today) {
        if (daysBetween(due, today) <= LATE_DAYS && !paidSince([r.key], due, cents)) planned.push({ on: today, label: r.label, cents, varies: !r.steady, late: due < today, manual: false });
      } else planned.push({ on: due, label: r.label, cents, varies: !r.steady, late: false, manual: false });
      if (!step) break;
    }
  }
  // Monthly and slower, like found bills of that kind: just the next one still to pay.
  for (const b of manual) {
    const own = ownKeys(b, found);
    const due = nextDueOn(b, today, (d) => paidSince(own, d, b.amountCents, true));
    if (!due || due > until) continue;
    planned.push({ on: due < today ? today : due, label: b.name, cents: b.amountCents, varies: false, late: due < today, manual: true });
  }
  planned.sort((a, b) => a.on.localeCompare(b.on) || b.cents - a.cents || a.label.localeCompare(b.label));

  let running = startCents;
  let lowest: { cents: number; on: string; after: string | null } = { cents: startCents, on: today, after: null };
  const events = planned.map((e) => {
    running -= e.cents;
    if (running < lowest.cents) lowest = { cents: running, on: e.on, after: e.label };
    return { ...e, runningCents: running };
  });
  const cushionCents = input.cushionCents ?? 0;
  return {
    ready: true,
    startCents,
    asOf,
    payday,
    until,
    events,
    lowest,
    cushionCents,
    safeCents: lowest.cents - cushionCents,
    counted: withBalance.map((a) => a.name),
    notCounted,
  };
}
