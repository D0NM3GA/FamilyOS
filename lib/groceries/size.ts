/**
 * "How it comes" (Phase 22): a product's package size as amount + unit + container
 * ("31.1 lb bag"), replacing the old free-for-all "Default unit". Pick lists, not free text,
 * so the list reads the same for everyone; stored as text so a list can grow without a
 * migration. No unit conversions: the size is a label, not a quantity to do maths on.
 */

export const SIZE_UNITS = ["lb", "oz", "kg", "g", "gal", "qt", "fl oz", "L", "ml", "count", "rolls", "loads", "pods"] as const;
export const CONTAINERS = ["bag", "box", "jug", "bottle", "can", "carton", "pack", "jar", "tub", "bunch", "each"] as const;

export type SizeUnit = (typeof SIZE_UNITS)[number];
export type Container = (typeof CONTAINERS)[number];

export type Size = { sizeAmount: number | null; sizeUnit: string | null; container: string | null };

// Counted units read as a pack: "12-roll pack", not "12 rolls pack".
const COUNT_UNITS: Record<string, string> = { count: "count", rolls: "roll", loads: "load", pods: "pod" };

function formatAmount(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** "31.1 lb bag", "12-roll pack", "1 gal jug", "by the bunch", "bag" — or null when nothing is set. */
export function describeSize({ sizeAmount, sizeUnit, container }: Size): string | null {
  const amount = sizeAmount != null && sizeAmount > 0 ? formatAmount(sizeAmount) : null;
  const unit = amount && sizeUnit ? sizeUnit : null;

  if (!unit) {
    if (container === "bunch") return "by the bunch";
    if (container === "each") return "each";
    return container ?? null;
  }

  const counted = COUNT_UNITS[unit];
  if (counted) {
    const what = container && container !== "each" ? container : null;
    if (counted === "count") return what ? `${amount}-count ${what}` : `${amount} count`;
    return what ? `${amount}-${counted} ${what}` : `${amount} ${unit}`;
  }
  return container && container !== "each" ? `${amount} ${unit} ${container}` : `${amount} ${unit}`;
}

/** True when nothing about the size is known yet — the list's "Needs details" sticker. */
export function needsSize(size: Size): boolean {
  return describeSize(size) == null;
}

const PLURALS: Record<string, string> = { box: "boxes", bunch: "bunches", loaf: "loaves", each: "" };

/** The list row's amount: "1 bag", "2 bags", "3" (no container known), "2 bunches". */
export function amountLabel(quantity: number, container: string | null): string {
  const n = formatAmount(quantity);
  if (!container || container === "each") return n;
  if (quantity === 1) return `${n} ${container}`;
  return `${n} ${PLURALS[container] ?? `${container}s`}`;
}

// Open Food Facts quantity strings, as printed on the pack: "31.1 lb", "400 g ℮", "1 gal",
// "16.9 fl oz (500 ml)", "12 rolls", "6 x 330 ml". Mapped onto SIZE_UNITS.
const OFF_UNITS: [RegExp, SizeUnit][] = [
  [/^(fl\.?\s*oz|fluid ounces?)$/, "fl oz"],
  [/^(lbs?|pounds?)$/, "lb"],
  [/^(oz|ounces?)$/, "oz"],
  [/^(kg|kilos?|kilograms?)$/, "kg"],
  [/^(g|gr|grams?)$/, "g"],
  [/^(gal|gallons?)$/, "gal"],
  [/^(qt|quarts?)$/, "qt"],
  [/^(l|liters?|litres?)$/, "L"],
  [/^(ml|millilit(er|re)s?)$/, "ml"],
  [/^(ct|count|pcs?|pieces?)$/, "count"],
  [/^rolls?$/, "rolls"],
  [/^loads?$/, "loads"],
  [/^pods?$/, "pods"],
];

/** The first "amount unit" in an Open Food Facts quantity, or null if it isn't one we know. */
export function parseOffQuantity(raw: string | null | undefined): { sizeAmount: number; sizeUnit: SizeUnit } | null {
  if (!raw) return null;
  // "6 x 330 ml" is a multipack: the pack count is what a family buys by, not the can size.
  const text = raw.toLowerCase().replace(/℮/g, " ").replace(/,(?=\d)/g, ".").trim();
  const multi = text.match(/^(\d+)\s*[x×]\s*/);
  if (multi) return { sizeAmount: Number(multi[1]), sizeUnit: "count" };

  const m = text.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid ounces?|[a-z]+)/);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = OFF_UNITS.find(([re]) => re.test(m[2].replace(/\s+/g, " ")))?.[1];
  return unit ? { sizeAmount: amount, sizeUnit: unit } : null;
}
