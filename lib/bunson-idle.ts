// Life while he sits: every so often a short clip (a nose wiggle, an ear
// twitch) plays and he settles back to his sitting pose. Random gaps, so it
// never looks like a metronome; never under prefers-reduced-motion (the
// component checks that).
export const IDLE_LIFE_FRAME_COUNT = 8;
export const IDLE_LIFE_FRAME_MS = 110;
export const IDLE_LIFE_MS = IDLE_LIFE_FRAME_COUNT * IDLE_LIFE_FRAME_MS;

export const IDLE_LIFE_MIN_GAP_MS = 4000;
export const IDLE_LIFE_MAX_GAP_MS = 8000;

/** The wait before the next wiggle, from a 0-1 random number. */
export function idleLifeGap(random: number): number {
  const r = Math.min(Math.max(random, 0), 1);
  return Math.round(IDLE_LIFE_MIN_GAP_MS + r * (IDLE_LIFE_MAX_GAP_MS - IDLE_LIFE_MIN_GAP_MS));
}

/** Which clip frame shows this far in, or null once it's over. */
export function idleLifeFrameIndex(elapsedMs: number): number | null {
  if (elapsedMs >= IDLE_LIFE_MS) return null;
  return Math.floor(Math.max(0, elapsedMs) / IDLE_LIFE_FRAME_MS);
}
