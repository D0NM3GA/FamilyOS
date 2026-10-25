// Periscoping: when he speaks he rises onto his hind legs (bunson-rise-0..8,
// 0 being his sitting pose), looks around while the bubble shows, and sits
// back down by playing the rise in reverse. The rise and the sit each take
// RISE_MS, the same 300ms the clip's height transition takes, so the clip
// grows and shrinks with him.
export const RISE_FRAME_COUNT = 9;
export const RISE_MS = 300;
export const RISE_FRAME_MS = RISE_MS / RISE_FRAME_COUNT;

// Standing tall, frames 3-8 differ only by a small head turn: played back and
// forth slowly, they read as him looking around.
const LOOK_AROUND: readonly number[] = [3, 4, 5, 6, 7, 8, 7, 6, 5, 4];
export const LOOK_FRAME_MS = 160;

/** Frame this far after he started rising: the rise, then looking around for as long as he speaks. */
export function riseFrameIndex(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs);
  if (t < RISE_MS) return Math.min(RISE_FRAME_COUNT - 1, Math.floor(t / RISE_FRAME_MS));
  // Starts from the top of the rise (8), so there's no jump when the rise ends.
  const look = Math.floor((t - RISE_MS) / LOOK_FRAME_MS) + LOOK_AROUND.indexOf(RISE_FRAME_COUNT - 1);
  return LOOK_AROUND[look % LOOK_AROUND.length];
}

/** Frame this far after he started sitting back down, or null once he's sitting. */
export function sitFrameIndex(elapsedMs: number): number | null {
  const t = Math.max(0, elapsedMs);
  if (t >= RISE_MS) return null;
  return RISE_FRAME_COUNT - 1 - Math.floor(t / RISE_FRAME_MS);
}
