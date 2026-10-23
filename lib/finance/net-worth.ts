import { shiftMonth } from "./budget";

/**
 * Phase 34: net worth, pure. What a jar has minus what it owes, now and at each month's end,
 * from bank-feed balances (FinBalanceDay, one per account per synced day) and things valued by
 * hand (FinHolding: the house, the cars, a loan the feed can't see).
 *
 * Signs: an account's balance counts as the bank gives it. SimpleFIN sends a credit card or
 * loan owed as a negative balance (Safe to spend relies on the same, lib/finance/forecast.ts),
 * so a negative account is listed under "owe" and a positive one under "have". A bank that
 * signs a loan the other way shows up under "have", in plain sight, rather than being guessed
 * at. A holding's value is always positive; a LOAN holding is owed.
 *
 * All days are civil "YYYY-MM-DD" strings (finance dates are UTC-midnight, read with UTC getters).
 */

export const HOLDING_KINDS = ["HOME", "VEHICLE", "OTHER_ASSET", "LOAN"] as const;
export type HoldingKind = (typeof HOLDING_KINDS)[number];

export const HOLDING_KIND: Record<HoldingKind, { emoji: string; label: string }> = {
  HOME: { emoji: "🏠", label: "Home" },
  VEHICLE: { emoji: "🚗", label: "Car" },
  OTHER_ASSET: { emoji: "💎", label: "Something else we own" },
  LOAN: { emoji: "🧾", label: "A loan (we owe)" },
};

export const isOwed = (kind: HoldingKind) => kind === "LOAN";

/** $20 million: a sanity cap on a value typed by hand (a house can be past the usual $1M cap). */
export const MAX_HOLDING_CENTS = 2_000_000_000;
/** Most holdings one jar can have, and values one holding keeps: plenty, and a cap on a runaway form. */
export const MAX_HOLDINGS = 100;
export const MAX_HOLDING_VALUES = 500;
/** How far back a value can be dated (when the house was bought). */
export const EARLIEST_VALUE_DAY = "1950-01-01";

/** A history, oldest first. */
export type Point = { day: string; cents: number };

export type WorthAccount = {
  id: string;
  /** The balance now (FinAccount.balanceCents), or null when the feed never gave one. */
  nowCents: number | null;
  /** FinBalanceDay rows, oldest first. */
  days: Point[];
};

export type WorthHolding = { id: string; kind: HoldingKind; /** Oldest first; never empty. */ values: Point[] };

/**
 * An account's balance now and when it was last heard of. A sync can come back without a balance
 * (it's optional in the feed), which clears balanceCents; the last one kept stands in, so the
 * account doesn't drop out of "now" while still counting last month. "Seen" is the newer of the
 * bank's own "as of" day and the last day a sync kept a balance.
 */
export function accountNow(balanceCents: number | null, balanceDay: string | null, days: Point[]): { cents: number | null; seen: string | null } {
  const kept = days.at(-1) ?? null;
  const seen = [balanceDay, kept?.day ?? null].filter((d): d is string => d != null).sort().at(-1) ?? null;
  return { cents: balanceCents ?? kept?.cents ?? null, seen };
}

/** The point on or before `day` (the newest one), else null. `points` oldest first. */
export function valueOn(points: Point[], day: string): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.day > day) break;
    found = p.cents;
  }
  return found;
}

/** "2026-02" → "2026-02-28". */
export function monthEnd(month: string): string {
  const next = Date.parse(`${shiftMonth(month, 1)}-01T00:00:00Z`);
  return new Date(next - 86_400_000).toISOString().slice(0, 10);
}

/**
 * `partial`: an account counted now has no balance for that month (its history hadn't started:
 * balances are kept from the day Net worth shipped, or it was connected later). Comparing with a
 * partial month would show the account's whole balance as a gain, so the page doesn't.
 */
export type WorthMonth = { month: string; haveCents: number; oweCents: number; netCents: number; partial: boolean };

/**
 * Month-end net worth for `months` (oldest first), the current month as of `today`. Months
 * before the first one with anything in it (a balance day, a holding's first value, or a
 * balance now) are dropped: there's nothing to say about them.
 *
 * - The current month uses each account's balance now, so it agrees with the big number.
 * - An account counts from its first balance day; before that it didn't exist here.
 * - A holding counts its earliest value back to the start of the bars: the house was owned
 *   before anyone typed it in, and a step up on the day it was added would be wrong.
 */
export function netWorthMonths(accounts: WorthAccount[], holdings: WorthHolding[], months: string[], today: string): WorthMonth[] {
  const current = today.slice(0, 7);
  const starts = [
    ...accounts.flatMap((a) => [...(a.days[0] ? [a.days[0].day.slice(0, 7)] : []), ...(a.nowCents != null ? [current] : [])]),
    ...holdings.flatMap((h) => (h.values[0] ? [h.values[0].day.slice(0, 7)] : [])),
  ];
  if (starts.length === 0) return [];
  const first = starts.reduce((a, b) => (b < a ? b : a));
  return months
    .filter((m) => m >= first && m <= current)
    .map((month) => {
      const at = month === current ? today : monthEnd(month);
      let have = 0;
      let owe = 0;
      let partial = false;
      for (const a of accounts) {
        const cents = month === current ? a.nowCents : valueOn(a.days, at);
        if (cents == null) {
          if (a.nowCents != null) partial = true;
          continue;
        }
        if (cents < 0) owe -= cents;
        else have += cents;
      }
      for (const h of holdings) {
        if (!h.values.length) continue;
        const cents = valueOn(h.values, at) ?? h.values[0].cents;
        if (isOwed(h.kind)) owe += cents;
        else have += cents;
      }
      return { month, haveCents: have, oweCents: owe, netCents: have - owe, partial };
    });
}

/** The 13 months ending at `today`'s: twelve bars, plus the month a year ago to compare with. */
export function worthWindow(today: string): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: 13 }, (_, i) => shiftMonth(current, i - 12));
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** A home or car value is due a look after about six months; a loan's balance after three. */
const STALE_AFTER_DAYS: Record<HoldingKind, number> = { HOME: 183, VEHICLE: 183, OTHER_ASSET: 183, LOAN: 92 };
/** A bank balance that hasn't moved in this long: the feed was disconnected or stopped. */
export const ACCOUNT_STALE_DAYS = 45;

/** Days since a holding's newest value, when that's long enough to ask "still right?"; else null. */
export function holdingStale(kind: HoldingKind, valuedOn: string, today: string): number | null {
  const age = daysBetween(valuedOn, today);
  return age > STALE_AFTER_DAYS[kind] ? age : null;
}

/** Days since an account's balance, when it's old enough that the feed has likely stopped; else null. */
export function accountStale(balanceDay: string | null, today: string): number | null {
  if (!balanceDay) return null;
  const age = daysBetween(balanceDay, today);
  return age > ACCOUNT_STALE_DAYS ? age : null;
}

/** "8 months ago", "3 weeks ago", "5 days ago". */
export function ageWords(days: number): string {
  if (days >= 60) {
    const m = Math.round(days / 30.4);
    return m >= 24 ? `${Math.round(days / 365)} years ago` : `${m} months ago`;
  }
  if (days >= 14) return `${Math.round(days / 7)} weeks ago`;
  return days === 1 ? "yesterday" : `${days} days ago`;
}
