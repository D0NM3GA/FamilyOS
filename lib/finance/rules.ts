/**
 * Phase 69c: "always file this store as …" rules. A merchant key keeps the town ("joes pizza
 * riverton"), so a rule on the whole key misses every other branch; a rule can instead cover keys
 * that start with it at a word ("joes pizza"). Pure.
 */

export type Rule = { key: string; categoryId: string; matchPrefix?: boolean };

/** The category for a key: an exact rule first, else the longest "every branch" rule it starts with. */
export function ruleResolver(rules: readonly Rule[]): (key: string) => string | undefined {
  const exact = new Map(rules.map((r) => [r.key, r.categoryId]));
  const prefixes = rules.filter((r) => r.matchPrefix).sort((a, b) => b.key.length - a.key.length);
  return (key) => {
    if (!key) return undefined;
    const hit = exact.get(key);
    if (hit) return hit;
    return prefixes.find((r) => key.startsWith(`${r.key} `))?.categoryId;
  };
}

/** The one rule that files a key: an exact one, else the longest "every branch" one it starts with. */
export function ruleFiling<R extends Pick<Rule, "key" | "matchPrefix">>(rules: readonly R[], key: string): R | undefined {
  if (!key) return undefined;
  return rules.find((r) => r.key === key) ?? [...rules].filter((r) => r.matchPrefix && key.startsWith(`${r.key} `)).sort((a, b) => b.key.length - a.key.length)[0];
}

/** Whether a rule covers a key: the same key, or an "every branch" rule it starts with. */
export function ruleCovers(rule: Pick<Rule, "key" | "matchPrefix">, key: string): boolean {
  return rule.key === key || (Boolean(rule.matchPrefix) && key.startsWith(`${rule.key} `));
}

/**
 * The key without its last word, for "every branch" ("joes pizza riverton" → "joes pizza"), or null
 * when there's nothing shorter worth offering (one word, or a first word of two letters or fewer).
 */
export function branchKey(key: string): string | null {
  const words = key.split(" ").filter(Boolean);
  if (words.length < 2) return null;
  const shorter = words.slice(0, -1).join(" ");
  return shorter.length >= 3 ? shorter : null;
}
