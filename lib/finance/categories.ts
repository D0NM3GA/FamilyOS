/**
 * Phase 26: categories and the merchant key. Pure.
 *
 * The merchant key is what rules, "still using this?" answers and recurring-bill detection
 * group by. It's computed from the best name a row has (the Privacy.com merchant when known,
 * else the payee, else the bank's description) and stored on the row (FinTransaction
 * .merchantKey), so it's the same string everywhere.
 */

import { formatMoney } from "@/lib/money";

export type CategoryKind = "SPEND" | "INCOME" | "TRANSFER";

export const STARTING_CATEGORIES: { key: string; name: string; emoji: string; kind: CategoryKind }[] = [
  { key: "groceries", name: "Groceries", emoji: "🛒", kind: "SPEND" },
  { key: "dining", name: "Dining", emoji: "🍔", kind: "SPEND" },
  { key: "car", name: "Gas & car", emoji: "⛽", kind: "SPEND" },
  { key: "bills", name: "Bills & utilities", emoji: "💡", kind: "SPEND" },
  { key: "subscriptions", name: "Subscriptions", emoji: "🔁", kind: "SPEND" },
  { key: "shopping", name: "Shopping", emoji: "🛍️", kind: "SPEND" },
  { key: "kids", name: "Kids", emoji: "🧸", kind: "SPEND" },
  { key: "health", name: "Health", emoji: "💊", kind: "SPEND" },
  { key: "home", name: "Home", emoji: "🏠", kind: "SPEND" },
  { key: "fun", name: "Fun", emoji: "🎈", kind: "SPEND" },
  { key: "travel", name: "Travel", emoji: "✈️", kind: "SPEND" },
  { key: "gifts", name: "Gifts", emoji: "🎁", kind: "SPEND" },
  { key: "other", name: "Other", emoji: "📦", kind: "SPEND" },
  { key: "income", name: "Income", emoji: "💵", kind: "INCOME" },
  { key: "transfers", name: "Transfers", emoji: "🔄", kind: "TRANSFER" },
];

// ---- Phase 37: a jar's own categories -----------------------------------------------------

/**
 * Categories the app itself counts on (spending that fits nowhere else, pay, money moving
 * between accounts), so they can be renamed but never removed. A removed category's
 * charges always have one of these, or another of the same kind, to go to.
 */
export const BUILT_IN_CATEGORY_KEYS: readonly string[] = ["other", "income", "transfers"];

export const isBuiltInCategory = (key: string) => BUILT_IN_CATEGORY_KEYS.includes(key);

/** Up to this many categories per jar; a dozen or two is plenty. */
export const MAX_CATEGORIES = 60;

/** The largest monthly budget the Budget tab takes ($9,999,999.99): two budgets added stay under it. */
export const MAX_BUDGET_CENTS = 999_999_999;

const KEY_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Six random letters and digits (crypto-random; works on the server and in tests alike). */
export function randomKeySuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => KEY_LETTERS[b % KEY_LETTERS.length]).join("");
}

/**
 * The key for a category a person added: its name as a slug plus a random suffix
 * ("Pets" → "pets-k3x9q2"). Made once and kept through renames, like a starting key. Every
 * added key has a dash and a suffix, which no starting key has, so the two can't collide.
 */
export function newCategoryKey(name: string, suffix: string = randomKeySuffix()): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return `${slug || "category"}-${suffix}`;
}

/**
 * A category as the logic that keys on starting categories sees it: its own key, plus the keys
 * of categories removed into it (FinCategory.absorbedKeys). Every check for a starting
 * category (guessing, Bills' "looks like a bill", grocery trips) goes through isCategoryKey or
 * findCategoryByKey, so removing one hands what the app did with it to the category its
 * charges went to.
 */
export type CategoryKeys = { key: string; absorbedKeys: string[] };

/** Whether this is the starting category `key`, or took it in when it was removed. */
export function isCategoryKey(category: CategoryKeys | null | undefined, key: string): boolean {
  return category != null && (category.key === key || category.absorbedKeys.includes(key));
}

/** The jar's category for a starting key: the one that has it as its own key, else the one it was removed into. */
export function findCategoryByKey<T extends CategoryKeys>(categories: T[], key: string): T | undefined {
  return categories.find((c) => c.key === key) ?? categories.find((c) => c.absorbedKeys.includes(key));
}

/**
 * The target's absorbed keys once `removed` is removed into it: the removed one's key and
 * everything it had taken in, but only starting keys. Those are the only keys code looks for
 * (guessing, bills, grocery trips); keeping a family-added category's random key too would let
 * the list grow without end, past what a money backup will restore.
 */
export function absorbedAfter(target: CategoryKeys, removed: CategoryKeys): string[] {
  return [...new Set([...target.absorbedKeys, removed.key, ...removed.absorbedKeys])].filter(
    (k) => k !== target.key && STARTING_KEYS.has(k),
  );
}

const STARTING_KEYS = new Set(STARTING_CATEGORIES.map((c) => c.key));

/**
 * The monthly budget left on the category a removed one's charges move to: the removed one's
 * when the target had none, the two added up when both had one, the target's alone otherwise.
 */
export function mergedBudget(target: number | null, removed: number | null): number | null {
  if (removed == null) return target;
  return Math.min(MAX_BUDGET_CENTS, (target ?? 0) + removed);
}

/** A category's monthly budget and saving up (Phase 31). */
export type Envelope = {
  name: string;
  budgetCents: number | null;
  rollover: boolean;
  rolloverFrom: string | null;
  goalCents: number | null;
  goalMonth: string | null;
};

export type MergedEnvelope = Omit<Envelope, "name"> & {
  /** The target wasn't saving up, so it took over the removed one's saving up (and goal). */
  tookSavings: boolean;
  /** Both were saving up: the removed one's saving up (and goal) went away. */
  droppedSavings: boolean;
};

const savesUp = (e: Envelope) => e.rollover || e.goalCents != null;

/**
 * What the target is left with when `removed` is removed into it. The budgets add up
 * (mergedBudget). Saving up can't be added together (a carry is worked out from one start
 * month with one budget), so a target that wasn't saving up takes over the removed one's
 * rollover, start month and goal, and one that was keeps its own.
 */
export function mergeEnvelope(target: Envelope, removed: Envelope): MergedEnvelope {
  const budgetCents = mergedBudget(target.budgetCents, removed.budgetCents);
  if (savesUp(removed) && !savesUp(target)) {
    const { rollover, rolloverFrom, goalCents, goalMonth } = removed;
    return { budgetCents, rollover, rolloverFrom, goalCents, goalMonth, tookSavings: true, droppedSavings: false };
  }
  const { rollover, rolloverFrom, goalCents, goalMonth } = target;
  return { budgetCents, rollover, rolloverFrom, goalCents, goalMonth, tookSavings: false, droppedSavings: savesUp(removed) };
}

/**
 * The remove question's line for one target: what happens to the budget and saving up. A
 * carry is always worked out from the current budget and the category's charges (Phase 31),
 * so when the result saves up, its saved-up amount is worked out again with the combined
 * budget and both categories' charges, the same as after any budget change. Null: nothing
 * to say (no budgets, no saving up).
 */
export function removalNote(removed: Envelope, target: Envelope): string | null {
  const merged = mergeEnvelope(target, removed);
  const lines: string[] = [];
  if (removed.budgetCents != null) {
    lines.push(
      target.budgetCents == null
        ? `${target.name} takes ${removed.name}'s ${formatMoney(removed.budgetCents)} monthly budget.`
        : `${target.name}'s monthly budget becomes ${formatMoney(merged.budgetCents!)}, the two added up.`,
    );
  }
  const goal = removed.goalCents != null;
  if (merged.tookSavings) lines.push(`${target.name} takes over ${removed.name}'s saving up${goal ? " and goal" : ""}.`);
  if (merged.droppedSavings) lines.push(`${removed.name}'s saving up${goal ? " and goal go" : " goes"} away; ${target.name} keeps its own.`);
  if (merged.rollover) lines.push(`${target.name}'s saved-up amount is worked out again with the combined budget and both categories' charges.`);
  return lines.length ? lines.join(" ") : null;
}

/**
 * The remove question's line about what the app did with this category by its key (its own,
 * or ones removed into it), which the category its charges go to takes over. Null for a
 * category the app does nothing special with.
 */
export function keyNote(removed: CategoryKeys & { name: string }): string | null {
  const keys = [removed.key, ...removed.absorbedKeys];
  const lines: string[] = [];
  if (keys.some((k) => KEYWORDS.some(([guessed]) => guessed === k))) lines.push(`Charges the app would have put in ${removed.name} go to the one you pick.`);
  if (keys.includes("groceries")) lines.push("Grocery trips get matched to charges in the one you pick instead.");
  if (keys.includes("bills") || keys.includes("subscriptions")) lines.push("Bills & ahead treats regular charges in the one you pick as bills, as it did here.");
  return lines.length ? lines.join(" ") : null;
}

/** "5 charges", "1 charge", "No charges". */
export function chargeCount(n: number): string {
  return n === 0 ? "No charges" : `${n} charge${n === 1 ? "" : "s"}`;
}

/** The merchant behind a row, normalized: "PWP*NETFLIX.COM PRIVACY.COM" and "NETFLIX.COM 866-579" → "netflix". */
export function merchantKeyOf(row: { merchantName?: string | null; payee?: string | null; description: string }): string {
  const raw = (row.merchantName || row.payee || row.description || "").toLowerCase();
  return raw
    .replace(/\b(pwp|sq|tst|sp|pp|paypal|pos|ach|dbt|debit|purchase|recurring|card|checkcard|visa|mc)\s*\*/g, " ")
    .replace(/privacy\.com|privacycom/g, " ")
    .replace(/\.(com|net|org|co|us)\b/g, " ")
    .replace(/\b(www|inc|llc|co|corp)\b/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\b[a-z]{2}$/g, (m) => (US_STATES.has(m) ? " " : m))
    .trim()
    // Short store numbers at the end ("ALDI 55", "SHELL 12"): one merchant, not one per store.
    .replace(/(\s\d{1,2})+$/, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 4)
    .join(" ")
    .slice(0, 60);
}

const US_STATES = new Set(
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(" "),
);

// Order matters: transfers first (a card payment's text can contain a store's or bank's
// name), then the specific ones.
const KEYWORDS: [string, RegExp][] = [
  ["transfers", /\b(payment thank you|autopay|auto pay|online payment|transfer|zelle|venmo|cash app|card payment|credit card payment|epay)\b/],
  ["income", /\b(payroll|direct dep|direct deposit|salary|paycheck|interest paid|dividend)\b/],
  ["subscriptions", /\b(netflix|spotify|hulu|disney|youtube|apple com bill|itunes|prime video|audible|patreon|xbox|playstation|nintendo|max|paramount|peacock|icloud|google storage|chatgpt|openai|adobe)\b/],
  ["groceries", /\b(kroger|walmart grocery|aldi|sams club|sam s club|costco|whole foods|trader joe|meijer|publix|heb|safeway|food lion|grocery|groceries|market)\b/],
  ["dining", /\b(doordash|uber eats|ubereats|grubhub|restaurant|cafe|coffee|starbucks|dunkin|mcdonald|chick fil a|chickfila|taco bell|wendy|burger|pizza|chipotle|panera|subway|kfc|sonic|dairy queen|bar & grill|grill)\b/],
  ["car", /\b(shell|exxon|mobil|chevron|bp|marathon|speedway|circle k|qt|quiktrip|wawa|sunoco|valero|fuel|gas|auto parts|autozone|jiffy|oil change|car wash|parking|toll)\b/],
  ["health", /\b(pharmacy|cvs|walgreens|rite aid|dental|dentist|clinic|hospital|doctor|medical|optometr|vision)\b/],
  ["bills", /\b(electric|energy|power|water|sewer|internet|comcast|xfinity|spectrum|verizon|at&t|att|t mobile|tmobile|insurance|geico|progressive|state farm|mortgage|rent|utility|utilities)\b/],
  ["kids", /\b(daycare|school|tuition|toys|lego|childcare)\b/],
  ["home", /\b(home depot|lowe s|lowes|ikea|wayfair|ace hardware|hardware)\b/],
  ["travel", /\b(airline|airlines|delta|united|southwest|american air|hotel|marriott|hilton|airbnb|expedia|uber|lyft)\b/],
  ["shopping", /\b(amazon|amzn|target|walmart|best buy|etsy|ebay|kohl|macy|old navy|tj maxx)\b/],
];

/** A starting category key for a row, or null when nothing's clear. */
export function guessCategory(key: string, amountCents: number): string | null {
  const text = ` ${key} `;
  for (const [cat, re] of KEYWORDS) {
    if (!re.test(text)) continue;
    if (cat === "income" && amountCents <= 0) continue;
    if (cat !== "income" && cat !== "transfers" && amountCents > 0) return null; // a refund: leave it for a person
    return cat;
  }
  return null;
}
