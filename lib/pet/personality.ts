import { pickWeighted, rngFor } from "./random";

/**
 * Phase 47: who a pet is, fixed at hatch from its seed. Nothing on screen lists these up
 * front; kids find them out by playing, and the stats page shows each once it's been noticed.
 * Pure and client-safe.
 */

export const TOYS = ["ball", "plush", "bubbles", "drum", "kite"] as const;
export type Toy = (typeof TOYS)[number];

export const FOODS = ["berries", "rice-ball", "pancake", "carrot", "fish"] as const;
export type Food = (typeof FOODS)[number];

export const PET_SPOTS = ["head", "cheeks", "belly", "back"] as const;
export type PetSpot = (typeof PET_SPOTS)[number];

const QUIRKS = ["sleepy", "bouncy", "shy", "show-off"] as const;
export type Quirk = (typeof QUIRKS)[number];

export type Personality = { favoriteToy: Toy; favoriteFood: Food; favoriteSpot: PetSpot; quirk: Quirk };

const even = <T>(values: readonly T[]) => values.map((value) => [value, 1] as const);

export function personalityFromSeed(seed: string): Personality {
  const rng = rngFor(seed, "personality");
  return {
    favoriteToy: pickWeighted(rng, even(TOYS)),
    favoriteFood: pickWeighted(rng, even(FOODS)),
    favoriteSpot: pickWeighted(rng, even(PET_SPOTS)),
    quirk: pickWeighted(rng, even(QUIRKS)),
  };
}
