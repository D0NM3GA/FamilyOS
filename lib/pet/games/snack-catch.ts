import { rngFor } from "../random";

/**
 * Phase 47.3, Snack Catch: treats and the odd broccoli fall; slide the bowl to catch treats.
 * Positions are fractions of the play area (x across, y down). Pure: the view calls `step`
 * every frame with the time since the round started.
 */

export const SNACK_CATCH_MS = 30_000;
export const BOWL_Y = 0.86;
export const BOWL_HALF_WIDTH = 0.11;
const DROPS = 30;

export type Drop = { id: number; x: number; spawnAt: number; speed: number; broccoli: boolean };
export type SnackCatchState = { score: number; treats: number; broccoli: number; resolved: ReadonlySet<number> };

export function snackSchedule(seed: string): Drop[] {
  const rng = rngFor(seed, "snack-catch");
  const gap = (SNACK_CATCH_MS - 3000) / DROPS;
  return Array.from({ length: DROPS }, (_, id) => ({
    id,
    x: 0.08 + rng() * 0.84,
    spawnAt: Math.round(id * gap + rng() * gap * 0.5),
    // A little faster as the round goes on: from about 2.6s to 1.6s to fall.
    speed: 0.38 + (id / DROPS) * 0.25,
    broccoli: rng() < 0.2,
  }));
}

/** How far down a drop is at time `t`: 0 at the top, 1 at the bottom; negative before it falls. */
export function dropY(drop: Drop, t: number): number {
  return ((t - drop.spawnAt) / 1000) * drop.speed;
}

export const START: SnackCatchState = { score: 0, treats: 0, broccoli: 0, resolved: new Set() };

/** Settles every drop that has reached the bowl's height: caught if the bowl is under it. */
export function step(state: SnackCatchState, drops: readonly Drop[], bowlX: number, t: number): SnackCatchState {
  let next = state;
  for (const drop of drops) {
    if (next.resolved.has(drop.id) || dropY(drop, t) < BOWL_Y) continue;
    const resolved = new Set(next.resolved).add(drop.id);
    const caught = Math.abs(drop.x - bowlX) <= BOWL_HALF_WIDTH;
    if (!caught) next = { ...next, resolved };
    else if (drop.broccoli) next = { ...next, resolved, broccoli: next.broccoli + 1, score: Math.max(0, next.score - 1) };
    else next = { ...next, resolved, treats: next.treats + 1, score: next.score + 1 };
  }
  return next;
}

export function isOver(t: number): boolean {
  return t >= SNACK_CATCH_MS;
}
