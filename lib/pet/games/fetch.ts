/**
 * Phase 47.3, Fetch Far: a marker sweeps back and forth along a bar; throw when it's in the
 * sweet spot. Three throws, each a little quicker. Pure.
 */

export const THROWS = 3;
export const SWEET_SPOT = 0.75;
export const SWEET_HALF_WIDTH = 0.06;

/** How long one sweep there and back takes for a throw. */
function sweepMs(throwIndex: number): number {
  return 1800 - throwIndex * 300;
}

/** Where the marker is, 0 to 1 along the bar, `t` ms into a throw. */
export function markerAt(t: number, throwIndex: number): number {
  const period = sweepMs(throwIndex);
  const phase = ((t % period) + period) % period / period;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/** How far a throw goes, 0 to 100: all the way in the sweet spot, less the further off. */
export function throwDistance(marker: number): number {
  const off = Math.max(0, Math.abs(marker - SWEET_SPOT) - SWEET_HALF_WIDTH);
  return Math.round(100 * Math.max(0, 1 - off / 0.45));
}
