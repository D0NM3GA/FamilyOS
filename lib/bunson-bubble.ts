// Bunson's wrapper is SPRITE_SIZE (136px) wide; the bubble is centered on it by
// default via `left: calc(50% + var(--bubble-shift))` plus a `-translate-x-1/2`
// on the bubble itself. WRAPPER_CENTER_PX is that 50% point in the wrapper's
// own coordinate space — re-derive if SPRITE_SIZE in components/bunson.tsx changes.
const WRAPPER_CENTER_PX = 68; // SPRITE_SIZE / 2

export const BUBBLE_WIDTH_PX = 224; // matches the bubble's inline width
const BUBBLE_HALF_PX = BUBBLE_WIDTH_PX / 2;

// How far the bubble's horizontal center must move (from directly-over-Bunson)
// to keep both edges at least edgeMarginPx inside the viewport. `canvasLeftPx`
// is Bunson's wrapper's own viewport-left (the same value written to
// style.left in the chase); `viewportWidthPx` should be
// document.documentElement.clientWidth, matching the chase's own clamp so the
// two never disagree about where the viewport's right edge actually is.
export function bubbleShift(
  canvasLeftPx: number,
  viewportWidthPx: number,
  edgeMarginPx: number,
): number {
  const centerNoShift = canvasLeftPx + WRAPPER_CENTER_PX;
  const min = edgeMarginPx + BUBBLE_HALF_PX - centerNoShift;
  const max = viewportWidthPx - edgeMarginPx - BUBBLE_HALF_PX - centerNoShift;
  // Same tie-break as clampCanvasLeft in components/bunson.tsx: when the
  // viewport is too narrow to satisfy both edges (min > max), the left bound
  // wins rather than centering on nothing.
  return Math.min(Math.max(0, min), Math.max(min, max));
}
