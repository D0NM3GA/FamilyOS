import type { ReceiptLine } from "@/lib/documents/receipt";

/**
 * Phase 24: matching receipt lines ("PURINA DOG FD 31.1LB") to Pantry items. Pure.
 *
 * Order per line: a learned alias (the family matched this exact text before) wins; then
 * the best fuzzy match among this trip's items (or, with no recent trip, the whole Pantry
 * at a stricter bar). Each item is suggested at most once per receipt. Only strong guesses
 * come pre-selected; weaker ones show as a hint with "Skip" selected, so a quick "Save"
 * can't teach the app a wrong match.
 */

export type MatchItem = { id: string; name: string; brand: string | null };

export type LineMatch = {
  key: string;
  productId: string | null;
  how: "learned" | "suggested" | "none";
  /** Whether the review form starts with this product selected (else "Skip"). */
  preselect: boolean;
  /** A non-item line (tax, bag fee, coupon) or one with no usable price: shown, never priced. */
  skip: boolean;
};

const TRIP_HINT = 0.45;
const TRIP_PRESELECT = 0.7;
const PANTRY_HINT = 0.6;
const PANTRY_PRESELECT = 0.85;

const NON_ITEM = /^(sub ?total|total|tax|balance|change|cash|visa|mastercard|amex|debit|credit|tender|savings|you saved|coupon|discount|bag fee|bottle deposit|crv|rounding|tip|gift card|rewards?|loyalty)\b/;

/** The line's text normalized so the same printed item always gives the same key. */
export function receiptTextKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$?\d+\.\d{2}\b/g, " ") // prices
    .replace(/\b\d{6,}\b/g, " ") // item codes
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

const STOP = new Set(["lb", "lbs", "oz", "ct", "pk", "ea", "each", "the", "and", "of", "with", "kg", "g", "ml", "l", "gal", "qt"]);

function tokens(text: string): string[] {
  return receiptTextKey(text)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+(\.\d+)?[a-z]*$/.test(t));
}

/** "food" -> "fd", "crackers" -> "crckrs": receipts abbreviate by dropping vowels. */
function skeleton(word: string): string {
  return word[0] + word.slice(1).replace(/[aeiou]/g, "");
}

function tokenMatch(r: string, p: string): boolean {
  if (r === p) return true;
  if (r.length >= 3 && p.startsWith(r)) return true;
  if (p.length >= 3 && r.startsWith(p)) return true;
  if (r.length >= 2 && (skeleton(p) === r || (r.length >= 3 && skeleton(p).startsWith(r)))) return true;
  return false;
}

/** Dice-style overlap between a receipt line and an item's name and brand, 0..1. */
export function similarity(lineText: string, item: MatchItem): number {
  const r = tokens(lineText);
  const name = tokens(item.name);
  if (r.length === 0 || name.length === 0) return 0;
  const brand = item.brand ? tokens(item.brand) : [];
  const pool = [...name, ...brand];
  const used = new Set<number>();
  let hits = 0;
  for (const rt of r) {
    const at = pool.findIndex((pt, i) => !used.has(i) && tokenMatch(rt, pt));
    if (at >= 0) {
      used.add(at);
      hits++;
    }
  }
  // Brand tokens help a match but don't count against an item for missing them.
  const nameHits = [...used].filter((i) => i < name.length).length;
  if (nameHits === 0) return 0;
  return (2 * hits) / (r.length + name.length + Math.min(brand.length, hits - nameHits));
}

export function isNonItem(line: ReceiptLine): boolean {
  const key = receiptTextKey(line.text);
  return !key || NON_ITEM.test(key) || line.totalCents == null || line.totalCents <= 0;
}

export function matchReceipt(opts: {
  lines: ReceiptLine[];
  aliases: Map<string, string>;
  /** This trip's items, or [] when the receipt isn't tied to a recent trip. */
  trip: MatchItem[];
  pantry: MatchItem[];
}): LineMatch[] {
  const { lines, aliases, trip, pantry } = opts;
  const pool = trip.length > 0 ? trip : pantry;
  const hint = trip.length > 0 ? TRIP_HINT : PANTRY_HINT;
  const strong = trip.length > 0 ? TRIP_PRESELECT : PANTRY_PRESELECT;
  const known = new Set(pantry.map((p) => p.id));

  const out: LineMatch[] = lines.map((line) => {
    const key = receiptTextKey(line.text);
    const skip = isNonItem(line);
    const learned = aliases.get(key);
    if (!skip && learned && known.has(learned)) return { key, productId: learned, how: "learned", preselect: true, skip };
    return { key, productId: null, how: "none", preselect: false, skip };
  });

  // Greedy best-first across all (line, item) pairs, so each item goes to its best line.
  const taken = new Set(out.flatMap((m) => (m.productId ? [m.productId] : [])));
  const pairs: { li: number; id: string; score: number }[] = [];
  lines.forEach((line, li) => {
    if (out[li].skip || out[li].productId) return;
    for (const item of pool) {
      const score = similarity(line.text, item);
      if (score >= hint) pairs.push({ li, id: item.id, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (out[p.li].productId || taken.has(p.id)) continue;
    out[p.li] = { ...out[p.li], productId: p.id, how: "suggested", preselect: p.score >= strong };
    taken.add(p.id);
  }
  return out;
}

/**
 * Per-one price for a line: the receipt's own unit price, else total / a whole-number
 * quantity (2 @ ...), else the total when no quantity is printed. Weighed lines (2.34 lb)
 * get no per-one price.
 */
export function unitCentsFor(line: { quantity: number | null; unitCents: number | null; totalCents: number }): number | null {
  if (line.quantity == null) return line.unitCents ?? line.totalCents;
  if (Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 50) {
    return line.unitCents ?? Math.round(line.totalCents / line.quantity);
  }
  return null;
}

