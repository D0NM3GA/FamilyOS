/** Words a bank adds that aren't part of the name. */
const NOISE = new Set(["ACH", "POS", "DEBIT", "PURCHASE", "PMT", "WEB", "RECURRING"]);
/** Capitals a person would write too, which have vowels so the no-vowel rule below misses them. */
const KEEP_CAPS = new Set(["AMC", "USAA", "IBM", "AAA", "UPS", "HBO", "IHOP", "AT&T", "BP", "KFC", "USA"]);

function tidyWord(word: string): string {
  if (KEEP_CAPS.has(word) || /[\d&]/.test(word) || (word.length <= 4 && !/[AEIOUY]/.test(word))) return word;
  // Capitalized after a slash or hyphen too: Kroger/Fuel. An apostrophe's letter stays small.
  return word.toLowerCase().replace(/(^|[/-])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * A bank's all-capitals description as a person would write it: "PUBLIX #1234" is Publix. For
 * showing only: keys, rules and exports keep what the bank sent. Anything already in mixed case
 * was written by someone and is left alone, and so is anything this would empty.
 */
export function tidyMerchantName(raw: string): string {
  if (/[a-z]/.test(raw)) return raw;
  const words = raw
    // A card processor's prefix and a reference after a star aren't the shop: SQ *COFFEE, AMAZON*AB123.
    .replace(/^(SQ|TST|PAYPAL|PP|PY)\s*\*\s*/, "")
    .replace(/\*\S*\d\S*/g, " ")
    .replace(/\.(COM|NET|ORG)\b(\/\S*)?/g, "")
    .replace(/#\s*\d+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 0 && (NOISE.has(words[words.length - 1]) || /^\d{3,}$/.test(words[words.length - 1]))) words.pop();
  return words.length > 0 ? words.map(tidyWord).join(" ") : raw;
}
