import { neededCall } from "./sim";
import { clampMeter, isHatched, METER_MAX, type PetState } from "./state";

/**
 * Phase 47: what a kid can do for their pet. Each takes the pet as it is right now (already
 * advanced to `minute`) and returns the new pet plus a word for how it went, which the screen
 * turns into a reaction. Pure; the server action loads, advances, applies and saves.
 *
 * Every kind of care adds bond, and answering the thing the pet was calling about adds more.
 * Nothing here can make bond go down.
 */

export type CareOutcome =
  | "ok"
  | "not-hatched"
  | "full"
  | "too-many-snacks"
  | "nothing-to-clean"
  | "not-sick"
  | "still-sick"
  | "cured"
  | "nothing-to-scold"
  | "confused"
  | "wriggled"
  | "too-tired";

export type CareResult = { state: PetState; outcome: CareOutcome };

export const MEAL_FILL = 25;
export const SNACK_FUN = 25;
export const SNACKS_BEFORE_SICK = 3;
export const SNACK_WINDOW_MINUTES = 30;
export const PETS_PER_HOUR = 3;
export const PET_FUN = 10;
const ANSWERED_BOND = 2;

function addBond(state: PetState, amount: number): PetState {
  return { ...state, bond: state.bond + amount, stageBond: state.stageBond + amount };
}

/** Clears the call if this care is what it was asking for, with a little extra bond. */
function answer(before: PetState, after: PetState): PetState {
  if (!before.call || before.call.kind === "fake" || neededCall(after) === before.call.kind) return after;
  return addBond({ ...after, call: null }, ANSWERED_BOND);
}

function unhatched(state: PetState): CareResult | null {
  return isHatched(state) ? null : { state, outcome: "not-hatched" };
}

export function feedMeal(state: PetState): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  if (state.hunger >= METER_MAX) return { state, outcome: "full" };
  const fed = addBond({ ...state, hunger: clampMeter(state.hunger + MEAL_FILL), weight: state.weight + 1 }, 1);
  return { state: answer(state, fed), outcome: "ok" };
}

export function feedSnack(state: PetState, minute: number): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  const recentSnacks = [...state.recentSnacks.filter((at) => minute - at < SNACK_WINDOW_MINUTES), minute];
  let next = addBond(
    { ...state, fun: clampMeter(state.fun + SNACK_FUN), weight: state.weight + 2, recentSnacks },
    1,
  );
  next = answer(state, next);
  if (recentSnacks.length <= SNACKS_BEFORE_SICK || next.sick) return { state: next, outcome: "ok" };
  // A tummy ache: a lucky charm still protects it, just like from the clock.
  if (next.charms > 0) return { state: { ...next, charms: next.charms - 1, recentSnacks: [] }, outcome: "ok" };
  return {
    state: { ...next, sick: true, dosesNeeded: 1, sickMinutes: 0, recentSnacks: [] },
    outcome: "too-many-snacks",
  };
}

export function clean(state: PetState): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  if (state.poops === 0) return { state, outcome: "nothing-to-clean" };
  return { state: addBond({ ...state, poops: 0 }, 1), outcome: "ok" };
}

export function giveMedicine(state: PetState): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  if (!state.sick) return { state, outcome: "not-sick" };
  const dosesNeeded = Math.max(0, state.dosesNeeded - 1);
  const treated = addBond({ ...state, dosesNeeded, sick: dosesNeeded > 0, sickMinutes: 0 }, 1);
  return { state: answer(state, treated), outcome: dosesNeeded > 0 ? "still-sick" : "cured" };
}

/** A gentle "No": right when it's fussing for nothing, confusing when it really needs something. */
export function sayNo(state: PetState): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  if (!state.call) return { state, outcome: "nothing-to-scold" };
  if (state.call.kind !== "fake") return { state, outcome: "confused" };
  return {
    state: addBond({ ...state, call: null, discipline: clampMeter(state.discipline + 25) }, 1),
    outcome: "ok",
  };
}

/** One petting session; too many in an hour and it wriggles away, giggling. */
export function petIt(state: PetState, minute: number, favoriteSpot: boolean): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  const recentPets = state.recentPets.filter((at) => minute - at < 60);
  if (recentPets.length >= PETS_PER_HOUR) return { state: { ...state, recentPets }, outcome: "wriggled" };
  const petted = addBond(
    {
      ...state,
      recentPets: [...recentPets, minute],
      fun: clampMeter(state.fun + (favoriteSpot ? PET_FUN * 2 : PET_FUN)),
    },
    favoriteSpot ? 3 : 2,
  );
  return { state: answer(state, petted), outcome: "ok" };
}

/** What playing (a toy or a mini-game) does; the caller caps a game's effect from its score. */
export type PlayEffect = { fun: number; hunger?: number; clean?: boolean; discipline?: number; energy: number };

export function play(state: PetState, effect: PlayEffect): CareResult {
  const blocked = unhatched(state);
  if (blocked) return blocked;
  if (state.sick || state.energy < effect.energy) return { state, outcome: "too-tired" };
  const played = addBond(
    {
      ...state,
      fun: clampMeter(state.fun + effect.fun),
      hunger: clampMeter(state.hunger + (effect.hunger ?? 0)),
      poops: effect.clean ? 0 : state.poops,
      discipline: clampMeter(state.discipline + (effect.discipline ?? 0)),
      energy: clampMeter(state.energy - effect.energy),
    },
    1,
  );
  return { state: answer(state, played), outcome: "ok" };
}
