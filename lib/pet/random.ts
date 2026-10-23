/**
 * Phase 47: seeded randomness for the pet. Every random thing the pet does comes from
 * `rngFor(seed, minute)`, so the same pet in the same minute always rolls the same numbers,
 * however the time in between was split up. Pure and client-safe.
 */

export type Rng = () => number;

/** A 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: small, fast and good enough for a pet. Returns numbers in [0, 1). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seed: string, ...parts: (string | number)[]): Rng {
  return mulberry32(hashString([seed, ...parts].join(":")));
}

/** Picks one entry by weight; entries with weight 0 or less never come up. */
export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const usable = entries.filter(([, weight]) => weight > 0);
  if (usable.length === 0) throw new Error("pickWeighted needs at least one positive weight");
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of usable) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return usable[usable.length - 1][0];
}
