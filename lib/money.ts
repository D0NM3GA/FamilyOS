/**
 * Phase 25: money as whole cents, parsed from decimal strings without floating point (bank
 * feeds send "-12.34"; "19.99" * 100 in floating point is 1998.9999999999998). The one money
 * kernel every domain uses. Two-decimal currencies only.
 */

// Postgres Int (cents columns): $21.4 million, far past anything a family sees.
export const MAX_CENTS = 2_147_483_647;

/** $1,000,000: a sanity cap on amounts typed by hand (same idea as a reward's sticker cap). */
export const MAX_TYPED_CENTS = 100_000_000;

/** "-12.34" → -1234, "5" → 500, "0.5" → 50. Null for anything else (3+ decimals, junk, huge). */
export function decimalToCents(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/,/g, "");
  const m = text.match(/^([+-]?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  const signed = m[1] === "-" ? -cents : cents;
  return Number.isSafeInteger(signed) && Math.abs(signed) <= MAX_CENTS ? signed : null;
}

export type MoneyParse = { ok: true; cents: number | null } | { ok: false; error: string };

/**
 * A money box someone typed in: "12", "12.3", "$12.34", "$1,234.56", ".50". Blank means "not
 * recorded" (null), not $0. Rejects negatives, more than two decimal places, and anything else,
 * with a message to show next to the box.
 */
export function parseMoneyInput(raw: string, { max = MAX_TYPED_CENTS }: { max?: number } = {}): MoneyParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, cents: null };

  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match || (match[1] === "" && match[2] === undefined)) {
    return { ok: false, error: `"${trimmed}" isn't a valid amount` };
  }

  const dollars = match[1] === "" ? 0 : Number(match[1]);
  const cents = dollars * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > max) {
    return { ok: false, error: "That amount is too large" };
  }
  return { ok: true, cents };
}

/** What a money box shows for a stored amount: 1250 → "12.50", 4000 → "40", null → "". */
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** "$1,234.56", "−$12.00" for a 3-letter currency code, else a plain amount. */
export function formatMoney(cents: number, currency = "USD"): string {
  const amount = cents / 100;
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      // unknown code: fall through
    }
  }
  return amount.toFixed(2);
}
