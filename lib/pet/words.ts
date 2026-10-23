import type { Personality } from "./personality";
import { rngFor } from "./random";
import { hearts, type DeathCause, type PetState, type Species, type Stage } from "./state";
import { fill, HAPPY_LINES, MOOD_LINES, pickLine } from "./voice";

/**
 * Phase 47: what the pet screen says. Kid-friendly and gentle, never guilt-tripping, and never
 * a word about chores, points or the reward word. Pure and client-safe.
 */

export const SPECIES_NAMES: Record<Species, string> = { blob: "Blob", bird: "Birdie", critter: "Critter" };

/** Each species' forms per stage, splendid first (lib/pet/state.ts FORMS_PER_STAGE). */
const FORM_NAMES: Record<Species, Partial<Record<Stage, readonly string[]>>> = {
  blob: {
    baby: ["Droplet"],
    child: ["Bouncy Blob", "Wobbly Blob"],
    teen: ["Shiny Blob", "Puddle Blob", "Grumbly Blob"],
    adult: ["Splendid Sprout", "Jelly Jumper", "Sleepy Slime", "Scruffy Splodge"],
  },
  bird: {
    baby: ["Fluffball"],
    child: ["Chirpy Chick", "Ruffled Chick"],
    teen: ["Bright Wing", "Scatter Wing", "Squawk Wing"],
    adult: ["Sky Dancer", "Song Finch", "Puffed Pigeon", "Scruffy Sparrow"],
  },
  critter: {
    baby: ["Nibbler"],
    child: ["Hopscotch", "Tumbleweed"],
    teen: ["Long Ears", "Fuzzball", "Grumpy Ears"],
    adult: ["Moon Hopper", "Velvet Ears", "Dozy Burrower", "Scruffy Thumper"],
  },
};

export function formName(species: Species, stage: Stage, form: number): string {
  if (stage === "egg") return "Egg";
  const names = FORM_NAMES[species][stage];
  return names?.[form] ?? names?.[0] ?? SPECIES_NAMES[species];
}

export const PET_NAME_MAX = 16;

/** A name made safe to keep (letters, numbers, spaces and simple punctuation), or null. */
export function cleanPetName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} '.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PET_NAME_MAX)
    .trim();
  return name.length > 0 ? name : null;
}

/**
 * The line under the room: what the pet is up to, in the pet's voice (lib/pet/voice.ts). The
 * same minute gives the same line, so it doesn't change every time the page refreshes.
 */
export function moodLine(
  pet: { name: string; species: Species; personality: Personality; seed: string },
  state: PetState,
  awake: boolean,
  napping: boolean,
  minute: number,
): string {
  const pool = (): readonly string[] => {
    if (state.stage === "egg") return MOOD_LINES.egg;
    if (!awake) return MOOD_LINES.asleep;
    if (state.sick) return MOOD_LINES.sick;
    if (napping) return MOOD_LINES.napping;
    if (hearts(state.hunger) <= 1) return MOOD_LINES.hungry;
    if (hearts(state.fun) <= 1) return MOOD_LINES.bored;
    if (state.poops > 0) return MOOD_LINES.messy;
    if (state.call?.kind === "fake") return MOOD_LINES.fussing;
    if (state.energy < 30) return MOOD_LINES.sleepy;
    return HAPPY_LINES[pet.personality.quirk];
  };
  // A new line every few minutes, not every refresh.
  const line = pickLine(pool(), rngFor(pet.seed, "mood", Math.floor(minute / 5)));
  return fill(line, { name: pet.name, species: pet.species, food: pet.personality.favoriteFood });
}

/** How a pet left, in gentle words. Pets come from Egg Island, and go back there. */
export const CAUSE_WORDS: Record<DeathCause, string> = {
  hunger: "got too hungry and went back to Egg Island, where there's always something to eat",
  sickness: "got too poorly and went back to Egg Island to rest",
  "old-age": "lived a long, happy life and retired to Egg Island",
};

/** A memory-book line: "Pip lived 12 days, grew into a Splendid Sprout, and retired to…" */
export function memoryLine(name: string, ageMinutes: number, finalForm: string, cause: DeathCause): string {
  const days = Math.max(1, Math.round(ageMinutes / (6 * 60)));
  const grew = finalForm === "Egg" ? "" : `, grew into a ${finalForm},`;
  return `${name} lived ${days} ${days === 1 ? "day" : "days"}${grew} and ${CAUSE_WORDS[cause]}.`;
}
