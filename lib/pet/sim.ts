import { careMinutesBetween, epochMinute, type CareHours } from "./care-hours";
import { rngFor, type Rng } from "./random";
import {
  ADULT_LIFESPAN_MINUTES,
  clampMeter,
  FORMS_PER_STAGE,
  isAlive,
  STAGE_MINUTES,
  STAGE_WEIGHT,
  type CallKind,
  type DeathCause,
  type PetState,
  type Stage,
} from "./state";

/**
 * Phase 47: the pet's clock. `advance` plays out every awake minute between two times and says
 * what happened. It's a pure function of its inputs, and each minute's dice come from the pet's
 * seed and that minute (`rngFor`), so catching up in one go or in pieces ends the same.
 *
 * Classic Tamagotchi rules, tuned for a pet that's only awake in care hours: meters drain,
 * poop and sickness come and go, calls missed for 15 minutes are care mistakes, mistakes pick
 * the grown-up form, and long neglect or old age ends it. An egg hatches on wall-clock time,
 * so a kid who sets one up at bedtime still finds a baby in the morning.
 */

export type PetEventKind =
  | "hatched"
  | "grew"
  | "pooped"
  | "got-sick"
  | "charm-saved"
  | "called"
  | "missed-call"
  | "napped"
  | "woke"
  | "gone";

export type PetEvent = { minute: number; kind: PetEventKind };

export type AdvanceContext = { seed: string; careHours: CareHours; timeZone: string };

/** Care-minutes to answer a call before it counts as a mistake. */
export const CALL_WINDOW_MINUTES = 15;
/** After a missed real call, the pet waits this long before calling again. */
const CALL_QUIET_MINUTES = 60;
/** A gap this long between awake minutes was a night's sleep: it wakes up rested. */
const SLEEP_GAP_MINUTES = 60;
const NAP_MINUTES = 30;
const MAX_POOPS = 4;
/** Care-minutes until each kind of neglect ends it. */
export const STARVE_LIMIT_MINUTES = 6 * 60;
export const SICK_LIMIT_MINUTES = 4 * 60;

type Growing = Exclude<Stage, "egg">;

/** Meter points lost per awake minute. */
const HUNGER_DRAIN: Record<Growing, number> = { baby: 1, child: 0.6, teen: 0.5, adult: 0.45 };
const FUN_DRAIN: Record<Growing, number> = { baby: 1, child: 0.7, teen: 0.6, adult: 0.5 };
const ENERGY_DRAIN = 0.25;
const NAP_ENERGY_GAIN = 2;
const POOP_CHANCE: Record<Growing, number> = { baby: 1 / 45, child: 1 / 80, teen: 1 / 100, adult: 1 / 120 };
const FAKE_CALL_CHANCE = 1 / 240;

const NEXT_STAGE: Record<Exclude<Stage, "adult">, Stage> = { egg: "baby", baby: "child", child: "teen", teen: "adult" };

/** Form thresholds: the highest score each form allows, splendid first. */
const FORM_SCORE_LIMITS: Partial<Record<Stage, number[]>> = {
  child: [1],
  teen: [1, 4],
  adult: [0, 2, 5],
};

/** Bond gained in a stage that counts as a mistake forgiven when it grows up. */
const BOND_FOR_BETTER_FORM = 20;

/**
 * Which form a pet grows into, from how the last stage went: each missed real call counts
 * double, a missed fake call once, and low discipline once. Bond and sparkle treats take
 * points off. A lower score is a more splendid form.
 */
export function pickForm(stage: Stage, state: PetState): number {
  const limits = FORM_SCORE_LIMITS[stage];
  if (!limits) return 0;
  const score =
    state.careMistakes * 2 +
    state.disciplineMistakes +
    (state.discipline < 50 ? 1 : 0) -
    state.sparkles -
    (state.stageBond >= BOND_FOR_BETTER_FORM ? 1 : 0);
  const form = limits.findIndex((limit) => score <= limit);
  return form === -1 ? FORMS_PER_STAGE[stage] - 1 : form;
}

function grow(state: PetState & { stage: Exclude<Stage, "adult"> }, minute: number, events: PetEvent[]): PetState {
  const stage = NEXT_STAGE[state.stage];
  const form = pickForm(stage, state);
  events.push({ minute, kind: state.stage === "egg" ? "hatched" : "grew" });
  return {
    ...state,
    stage,
    form,
    // Sparkle treats count once, at the growth they helped.
    sparkles: FORM_SCORE_LIMITS[stage] ? 0 : state.sparkles,
    weight: Math.max(state.weight, STAGE_WEIGHT[stage]),
    careMistakes: 0,
    disciplineMistakes: 0,
    stageBond: 0,
    stageMinutes: 0,
    lifespanMinutes: stage === "adult" ? ADULT_LIFESPAN_MINUTES[form] : state.lifespanMinutes,
  };
}

function end(state: PetState, cause: DeathCause, minute: number, events: PetEvent[]): PetState {
  events.push({ minute, kind: "gone" });
  return { ...state, cause, call: null };
}

/** The real need a pet would call about right now, most urgent first. */
export function neededCall(state: PetState): Exclude<CallKind, "fake"> | null {
  if (state.sick) return "sick";
  if (state.hunger <= 0) return "hunger";
  if (state.fun <= 0) return "fun";
  return null;
}

function updateCall(state: PetState, minute: number, rng: Rng, events: PetEvent[]): PetState {
  let next = state;
  const call = next.call;
  if (call && call.kind !== "fake" && neededCall(next) !== call.kind) {
    next = { ...next, call: null };
  } else if (call && minute - call.since >= CALL_WINDOW_MINUTES) {
    events.push({ minute, kind: "missed-call" });
    next =
      call.kind === "fake"
        ? { ...next, call: null, disciplineMistakes: next.disciplineMistakes + 1 }
        : { ...next, call: null, careMistakes: next.careMistakes + 1, quietUntil: minute + CALL_QUIET_MINUTES };
  }
  if (next.call || minute < next.quietUntil) return next;

  const need = neededCall(next);
  const fussy =
    (next.stage === "child" || next.stage === "teen") && next.hunger > 50 && next.fun > 50 && !next.sick;
  // Roll every minute either way, so a fake call doesn't depend on whether a real one fired.
  const roll = rng();
  const kind: CallKind | null = need ?? (fussy && roll < FAKE_CALL_CHANCE ? "fake" : null);
  if (!kind) return next;
  events.push({ minute, kind: "called" });
  return { ...next, call: { kind, since: minute } };
}

function tick(state: PetState, minute: number, seed: string, events: PetEvent[]): PetState {
  const stage = state.stage as Growing;
  const rng = rngFor(seed, minute);
  let next: PetState = { ...state };

  if (minute - next.lastAwakeMinute > SLEEP_GAP_MINUTES) {
    next.energy = 100;
    next.napUntil = minute;
    events.push({ minute, kind: "woke" });
  }
  next.lastAwakeMinute = minute;

  const napping = minute < next.napUntil;
  next.hunger = clampMeter(next.hunger - HUNGER_DRAIN[stage] * (napping ? 0.5 : 1));
  if (napping) {
    next.energy = clampMeter(next.energy + NAP_ENERGY_GAIN);
  } else {
    next.fun = clampMeter(next.fun - FUN_DRAIN[stage] * (next.sick ? 1.5 : 1));
    next.energy = clampMeter(next.energy - ENERGY_DRAIN);
    if (next.energy < 15 && !next.sick && !next.call) {
      next.napUntil = minute + NAP_MINUTES;
      events.push({ minute, kind: "napped" });
    }
  }

  if (next.poops < MAX_POOPS && rng() < POOP_CHANCE[stage]) {
    next.poops += 1;
    events.push({ minute, kind: "pooped" });
  }

  const overweight = next.weight > STAGE_WEIGHT[stage] * 2;
  const sickChance = 0.0005 + next.poops * 0.002 + (overweight ? 0.002 : 0);
  if (!next.sick && rng() < sickChance) {
    if (next.charms > 0) {
      next.charms -= 1;
      events.push({ minute, kind: "charm-saved" });
    } else {
      next.sick = true;
      next.dosesNeeded = rng() < 0.5 ? 1 : 2;
      next.sickMinutes = 0;
      events.push({ minute, kind: "got-sick" });
    }
  }

  next.sickMinutes = next.sick ? next.sickMinutes + 1 : 0;
  next.starvingMinutes = next.hunger <= 0 ? next.starvingMinutes + 1 : 0;
  if (next.sickMinutes >= SICK_LIMIT_MINUTES) return end(next, "sickness", minute, events);
  if (next.starvingMinutes >= STARVE_LIMIT_MINUTES) return end(next, "hunger", minute, events);

  next = updateCall(next, minute, rng, events);

  next.stageMinutes += 1;
  next.ageMinutes += 1;
  if (next.stage === "adult") {
    if (next.stageMinutes >= next.lifespanMinutes) return end(next, "old-age", minute, events);
  } else if (next.stageMinutes >= STAGE_MINUTES[next.stage as Exclude<Growing, "adult">]) {
    next = grow(next as PetState & { stage: Exclude<Growing, "adult"> }, minute, events);
  }
  return next;
}

/** Plays the pet forward from `fromMs` to `toMs`. Times before `fromMs` are never replayed. */
export function advance(
  state: PetState,
  fromMs: number,
  toMs: number,
  context: AdvanceContext,
): { state: PetState; events: PetEvent[] } {
  const events: PetEvent[] = [];
  let next = state;
  let fromMinute = epochMinute(fromMs);
  const toMinute = epochMinute(toMs);
  if (!isAlive(next) || toMinute <= fromMinute) return { state: next, events };

  if (next.stage === "egg") {
    const toHatch = STAGE_MINUTES.egg - next.stageMinutes;
    if (toMinute - fromMinute < toHatch) {
      return { state: { ...next, stageMinutes: next.stageMinutes + toMinute - fromMinute }, events };
    }
    fromMinute += toHatch;
    // A fresh baby is wide awake and hasn't slept yet.
    next = { ...grow({ ...next, stage: "egg" }, fromMinute, events), lastAwakeMinute: fromMinute, napUntil: fromMinute };
    next = { ...next, quietUntil: Math.max(next.quietUntil, fromMinute) };
  }

  for (const minute of careMinutesBetween(fromMinute, toMinute, context.careHours, context.timeZone)) {
    next = tick(next, minute, context.seed, events);
    if (!isAlive(next)) break;
  }
  return { state: next, events };
}
