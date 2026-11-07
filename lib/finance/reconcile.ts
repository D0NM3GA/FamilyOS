/**
 * Phase 25: the reconciler, the one place that decides what's real. Pure: rows in,
 * decisions out; lib/finance/sync.ts applies them in a transaction.
 *
 * Trust order: the bank feed (SIMPLEFIN) is the master source; statement files (MANUAL)
 * fill gaps; Privacy.com charges only enrich bank rows. Rules, all deterministic:
 * 1. Same source + same id: one row (the database's unique key; a re-sync updates it).
 * 2. A pending feed row the feed no longer reports, inside the window it was asked about,
 *    is SUPERSEDED (it posted under a new id, or the hold dropped). So is one older than
 *    STALE_PENDING_DAYS that the feed didn't report (Phase 60): a hotel or fuel hold from before
 *    the window would otherwise stay pending for good and count twice.
 * 3. A MANUAL row and a feed row in the same account with the same amount on the same day
 *    are the same money: the MANUAL one becomes a DUPLICATE. Same amount within 3 days is
 *    only a "possible duplicate" for a person to answer, unless they already said
 *    "two different charges" for that pair.
 */

export type DayRow = { id: string; postedOn: string; amountCents: number };

const DAY_MS = 86_400_000;
const NEAR_DAYS = 3;
const PRIVACY_DAYS = 4;

export function dayDiff(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

/** Canonical key for an unordered pair, so (A,B) and (B,A) are one question. */
export function dupKey(a: string, b: string): string {
  return a < b ? `dup:${a}:${b}` : `dup:${b}:${a}`;
}

/** A hold this many days old that the feed no longer reports has posted or dropped. */
export const STALE_PENDING_DAYS = 14;

/**
 * Rule 2. `pending` are this account's ACTIVE pending feed rows. With `today`, an unreported one
 * older than STALE_PENDING_DAYS goes too, wherever the window starts. Not when the feed sent no
 * rows for the account at all (an account error): an in-window row comes back on the next good
 * sync, but an old one is never reported again, so a wrong SUPERSEDED would be for good.
 */
export function supersededPending(
  pending: (DayRow & { externalId: string })[],
  reportedIds: Set<string>,
  windowStart: string,
  today?: string,
): string[] {
  const staleOk = today != null && reportedIds.size > 0;
  return pending
    .filter((p) => !reportedIds.has(p.externalId))
    .filter((p) => p.postedOn >= windowStart || (staleOk && p.postedOn < today && dayDiff(p.postedOn, today) > STALE_PENDING_DAYS))
    .map((p) => p.id);
}

/**
 * Rule 3, one account. Each row pairs at most once; exact-day pairs first, then the nearest
 * in days. `answered` holds pair keys a person already decided.
 */
export function findDuplicates(
  manual: DayRow[],
  feed: DayRow[],
  answered: Set<string>,
): { same: [manualId: string, feedId: string][]; possible: [manualId: string, feedId: string][] } {
  const pairs: { m: DayRow; f: DayRow; days: number }[] = [];
  for (const m of manual) {
    for (const f of feed) {
      if (m.amountCents !== f.amountCents) continue;
      const days = dayDiff(m.postedOn, f.postedOn);
      if (days <= NEAR_DAYS && !answered.has(dupKey(m.id, f.id))) pairs.push({ m, f, days });
    }
  }
  pairs.sort((a, b) => a.days - b.days || a.m.id.localeCompare(b.m.id));
  const used = new Set<string>();
  const same: [string, string][] = [];
  const possible: [string, string][] = [];
  for (const p of pairs) {
    if (used.has(p.m.id) || used.has(p.f.id)) continue;
    used.add(p.m.id);
    used.add(p.f.id);
    (p.days === 0 ? same : possible).push([p.m.id, p.f.id]);
  }
  return { same, possible };
}

const PRIVACY_TEXT = /\bPWP\b|PRIVACY/i;

/**
 * Privacy.com charges to bank rows: the bank row's text names Privacy, the bank amount is the
 * charge as money out, within 4 days. One-to-one, nearest first.
 */
export function matchPrivacy(
  charges: { id: string; amountCents: number; occurredOn: string }[],
  bank: (DayRow & { description: string })[],
): [chargeId: string, txnId: string][] {
  const pairs: { c: string; t: string; days: number }[] = [];
  for (const c of charges) {
    for (const t of bank) {
      if (t.amountCents !== -c.amountCents || !PRIVACY_TEXT.test(t.description)) continue;
      const days = dayDiff(c.occurredOn, t.postedOn);
      if (days <= PRIVACY_DAYS) pairs.push({ c: c.id, t: t.id, days });
    }
  }
  pairs.sort((a, b) => a.days - b.days);
  const used = new Set<string>();
  const out: [string, string][] = [];
  for (const p of pairs) {
    if (used.has(p.c) || used.has(p.t)) continue;
    used.add(p.c);
    used.add(p.t);
    out.push([p.c, p.t]);
  }
  return out;
}
