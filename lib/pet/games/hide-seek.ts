import { rngFor } from "../random";

/**
 * Phase 47.3, Hide and Seek: the pet hides behind something in its room (the more decorated,
 * the more places), and the kid has three tries a round to find it. Three rounds. Pure.
 */

export const ROUNDS = 3;
export const TRIES = 3;

/** Every room has these to hide behind; decorations on the floor and shelf add more. */
export const BUILT_IN_SPOTS = ["bed", "toybox", "rug"] as const;

export type HideSeekState = { round: number; tries: number; found: number; done: boolean };

export const START: HideSeekState = { round: 0, tries: 0, found: 0, done: false };

/** Where the pet hides each round: never the same place twice in a row. */
export function hidingPlaces(seed: string, spots: readonly string[]): string[] {
  const rng = rngFor(seed, "hide-seek");
  const places: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const options = spots.filter((spot) => spot !== places[round - 1]);
    places.push(options[Math.floor(rng() * options.length)] ?? spots[0]);
  }
  return places;
}

/** One guess. A find or the last try ends the round. */
export function guess(state: HideSeekState, places: readonly string[], spot: string): { state: HideSeekState; found: boolean } {
  if (state.done) return { state, found: false };
  const found = places[state.round] === spot;
  const tries = state.tries + 1;
  if (!found && tries < TRIES) return { state: { ...state, tries }, found };
  const round = state.round + 1;
  return {
    state: { round, tries: 0, found: state.found + (found ? 1 : 0), done: round >= ROUNDS },
    found,
  };
}
