// Pure (no Prisma import) so prisma/seed.ts and the backup remap can use it too.

/**
 * The key that makes two typed names the same Pantry item: case, punctuation, spacing and a
 * plain trailing "s" don't count ("Eggs", "egg", "EGG!" are one item). Deliberately naive:
 * a near-miss makes a second item, which the Pantry's "Same as…" merge fixes, while an
 * over-eager key would silently fold two real items together.
 */
export function productNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}
