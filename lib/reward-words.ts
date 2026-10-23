import { appNameLength, cleanAppName } from "@/lib/app-name";

/**
 * Phase 35: what the kids earn and where they spend it, in the family's own words
 * (Settings → Make it yours). Stickers and the Sticker Store until a family picks something
 * else; a preset, or their own ("acorn" / "acorns" / "Acorn Shop"). Only the words change:
 * balances, points columns and the Sticker Book look stay as they are. Pure.
 */

export type RewardWords = { one: string; many: string; store: string };

export const DEFAULT_REWARD_WORDS: RewardWords = { one: "sticker", many: "stickers", store: "Sticker Store" };

export const REWARD_PRESETS: readonly ({ id: string } & RewardWords)[] = [
  { id: "stickers", ...DEFAULT_REWARD_WORDS },
  { id: "stars", one: "star", many: "stars", store: "Star Shop" },
  { id: "points", one: "point", many: "points", store: "Points Store" },
  { id: "coins", one: "coin", many: "coins", store: "Coin Shop" },
  { id: "gems", one: "gem", many: "gems", store: "Gem Shop" },
];

export const REWARD_WORD_MAX = 16;
export const STORE_NAME_MAX = 24;

/** The words kept on a household; any missing one means the stickers default for all three. */
export function rewardWordsOf(row: { rewardOne: string | null; rewardMany: string | null; rewardStore: string | null }): RewardWords {
  const one = cleanAppName(row.rewardOne);
  const many = cleanAppName(row.rewardMany);
  const store = cleanAppName(row.rewardStore);
  return one && many && store ? { one, many, store } : DEFAULT_REWARD_WORDS;
}

/** Which preset these words are, or "custom". */
export function rewardPresetId(words: RewardWords): string {
  return REWARD_PRESETS.find((p) => p.one === words.one && p.many === words.many && p.store === words.store)?.id ?? "custom";
}

/**
 * Typed words made safe to keep, or an error to show. A family's own word is lower case in
 * sentences ("5 acorns"), so it's stored as typed but trimmed; the store name keeps its caps.
 */
export function checkRewardWords(raw: RewardWords): { ok: true; words: RewardWords } | { ok: false; error: string } {
  const one = cleanAppName(raw.one);
  const many = cleanAppName(raw.many);
  const store = cleanAppName(raw.store);
  if (!one || !many || !store) return { ok: false, error: "Fill in all three: one, many and the store's name." };
  if (appNameLength(one) > REWARD_WORD_MAX || appNameLength(many) > REWARD_WORD_MAX) {
    return { ok: false, error: `Keep the reward word to ${REWARD_WORD_MAX} characters or fewer.` };
  }
  if (appNameLength(store) > STORE_NAME_MAX) return { ok: false, error: `Keep the store's name to ${STORE_NAME_MAX} characters or fewer.` };
  return { ok: true, words: { one, many, store } };
}

/** "1 sticker", "5 stickers", "-1 sticker" (a balance can dip below zero). */
export function rewardCount(n: number, words: RewardWords): string {
  return `${n} ${Math.abs(n) === 1 ? words.one : words.many}`;
}

/** How many more a kid needs: "1 more sticker", "15 more stickers". */
export function moreToGo(n: number, words: RewardWords): string {
  return `${n} more ${Math.abs(n) === 1 ? words.one : words.many}`;
}

/** The word starting a sentence or a label: "Stickers", "Acorns". */
export function capitalized(word: string): string {
  const [first = "", ...rest] = word;
  return first.toUpperCase() + rest.join("");
}
