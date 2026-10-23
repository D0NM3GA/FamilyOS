import type { CareOutcome } from "./care";
import { hearts, type DeathCause, type PetState, type Species, type Stage } from "./state";

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

/** The pet's mood in words, for the status line and screen readers. */
export function moodLine(name: string, state: PetState, awake: boolean, napping: boolean): string {
  if (state.stage === "egg") return `${name} is still an egg. Something is wiggling inside!`;
  if (!awake) return `${name} is fast asleep. Come back when it's awake.`;
  if (state.sick) return `${name} feels poorly and needs medicine.`;
  if (napping) return `${name} is having a little nap.`;
  const needs: string[] = [];
  if (hearts(state.hunger) <= 1) needs.push("hungry");
  if (hearts(state.fun) <= 1) needs.push("bored");
  if (state.poops > 0) needs.push("needs a clean-up");
  if (needs.length > 0) return `${name} is ${needs.join(" and ")}.`;
  if (state.call?.kind === "fake") return `${name} is making a fuss about something.`;
  if (state.energy < 30) return `${name} is getting sleepy.`;
  return `${name} is happy!`;
}

export const CAUSE_WORDS: Record<DeathCause, string> = {
  hunger: "went off to find snacks somewhere far away",
  sickness: "got too poorly and floated off to rest",
  "old-age": "lived a long, happy life",
};

/** A memory-book line: "Pip lived 12 days and grew into a Splendid Sprout." */
export function memoryLine(name: string, ageMinutes: number, finalForm: string, cause: DeathCause): string {
  const days = Math.max(1, Math.round(ageMinutes / (6 * 60)));
  const grew = finalForm === "Egg" ? "" : ` and grew into a ${finalForm}`;
  return `${name} lived ${days} ${days === 1 ? "day" : "days"}${grew}, and ${CAUSE_WORDS[cause]}.`;
}

/** What the pet does or says after you care for it. */
export const OUTCOME_WORDS: Record<CareOutcome, string> = {
  ok: "",
  "not-hatched": "The egg just wobbles.",
  full: "Too full! Maybe later.",
  "too-many-snacks": "Uh oh, too many snacks. A tummy ache!",
  "nothing-to-clean": "Already spotless!",
  "not-sick": "No medicine needed, it feels fine.",
  "still-sick": "One more dose should do it.",
  cured: "All better!",
  "nothing-to-scold": "It looks at you, puzzled. It wasn't doing anything!",
  confused: "It really needed something. Check what it's asking for.",
  wriggled: "It wriggles away, giggling. Enough cuddles for now!",
  "too-tired": "Too tired to play. Maybe after a nap.",
};
