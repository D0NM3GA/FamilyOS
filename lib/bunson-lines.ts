/**
 * Pure line-picking logic for Bunson's speech bubble — no DOM, no timers — following the
 * same pattern as this file's siblings (lib/bunson-hop.ts, -bubble.ts, -chase.ts, -loco.ts).
 * components/bunson.tsx owns the click handling and animation; this owns "which string."
 */

export type BunsonLineState = { lastSpoken: string | null; hasSpokenFact: boolean };

export const INITIAL_BUNSON_LINE_STATE: BunsonLineState = { lastSpoken: null, hasSpokenFact: false };

/** Picks a random entry from `pool`, preferring one that differs from `exclude`. */
function pickDifferent(pool: string[], exclude: string | null, random: () => number): string {
  const candidates = exclude === null ? pool : pool.filter((line) => line !== exclude);
  const from = candidates.length > 0 ? candidates : pool;
  return from[Math.floor(random() * from.length)];
}

/**
 * Weighted draw between a household's real-data `facts` and the static joke `lines`.
 *
 * The first-ever pick favors a fact (if any exist) — otherwise a fact would only turn up on
 * a roughly 1-in-(facts+lines) draw against a much larger static joke list, effectively
 * burying the feature. Every pick after that is a coin flip between the two pools.
 *
 * Also guarantees the returned line differs from `state.lastSpoken` whenever the combined
 * pool has more than one distinct string — components/bunson.tsx's screen-reader live
 * region only reliably re-announces when its content actually changes, and `facts` will
 * routinely have exactly one entry, where a naive per-pool draw could repeat.
 *
 * `random` is injectable (defaults to Math.random) so tests can force both the coin flip
 * and the index draw deterministically.
 */
export function pickBunsonLine(
  facts: string[],
  lines: string[],
  state: BunsonLineState,
  random: () => number = Math.random,
): { line: string; nextState: BunsonLineState } {
  const wantFact = facts.length > 0 && (!state.hasSpokenFact || random() < 0.5);
  const primary = wantFact ? facts : lines;

  let line = pickDifferent(primary, state.lastSpoken, random);
  if (line === state.lastSpoken) {
    const fallback = wantFact ? lines : facts;
    if (fallback.length > 0) line = pickDifferent(fallback, state.lastSpoken, random);
  }

  return { line, nextState: { lastSpoken: line, hasSpokenFact: state.hasSpokenFact || wantFact } };
}
