export const HOP_FRAME_MS = 90;
export const HOP_FRAME_COUNT = 8;
export const HOP_LOOPS = 2;
export const HOP_MS = HOP_FRAME_MS * HOP_FRAME_COUNT * HOP_LOOPS; // 1440

// Elapsed-time frame index, not a tick counter — self-corrects after any stall
// or hidden-tab throttling instead of stretching the hop out. Returns null once
// the hop has resolved to idle.
export function hopFrameIndex(elapsedMs: number): number | null {
  if (elapsedMs >= HOP_MS) return null;
  const clamped = Math.max(0, elapsedMs);
  return Math.floor(clamped / HOP_FRAME_MS) % HOP_FRAME_COUNT;
}
