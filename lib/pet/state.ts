/**
 * Phase 47: what a pet is, as plain data. The simulation (`sim.ts`) and care (`care.ts`) take
 * one of these and return a new one; the database keeps it. Pure and client-safe.
 *
 * Meters run 0–100, where 100 is good (full, having fun, rested). Times are epoch minutes
 * (`care-hours.ts`), and durations are care-minutes: minutes the pet was awake.
 */

export const SPECIES = ["blob", "bird", "critter"] as const;
export type Species = (typeof SPECIES)[number];

export const STAGES = ["egg", "baby", "child", "teen", "adult"] as const;
export type Stage = (typeof STAGES)[number];

/** How many grown-up forms each stage has; form 0 is the most splendid. */
export const FORMS_PER_STAGE: Record<Stage, number> = { egg: 1, baby: 1, child: 2, teen: 3, adult: 4 };

export type CallKind = "hunger" | "fun" | "sick" | "fake";
export type Call = { kind: CallKind; since: number };

export type DeathCause = "hunger" | "sickness" | "old-age";

export type PetState = {
  species: Species;
  stage: Stage;
  /** Which of the stage's forms (`FORMS_PER_STAGE`); picked by `pickForm` as it grows. */
  form: number;
  hunger: number;
  fun: number;
  energy: number;
  discipline: number;
  /** Grams, for show; snacks add more than meals. */
  weight: number;
  /** Grows with every kind of care and play, never drops. Unlocks tricks, helps the next form. */
  bond: number;
  /** Bond gained since the last growth, which is what helps pick the next form. */
  stageBond: number;
  poops: number;
  sick: boolean;
  /** Doses of medicine still needed while sick. */
  dosesNeeded: number;
  /** Care-minutes sick in a row. */
  sickMinutes: number;
  /** Care-minutes in a row with an empty hunger meter. */
  starvingMinutes: number;
  call: Call | null;
  /** No new real call before this minute: after a missed one, the pet waits before calling again. */
  quietUntil: number;
  careMistakes: number;
  disciplineMistakes: number;
  /** Care-minutes in this stage, and in its whole life. */
  stageMinutes: number;
  ageMinutes: number;
  /** Care-minutes an adult lives, set when it grows up. */
  lifespanMinutes: number;
  /** Napping (no fun lost, energy coming back) until this minute. */
  napUntil: number;
  /** The last care-minute it was awake, so a night's sleep can be noticed. */
  lastAwakeMinute: number;
  /** Minutes of recent snacks, for "too many snacks makes it sick". */
  recentSnacks: number[];
  /** Minutes of recent petting, for "too much and it wriggles away". */
  recentPets: number[];
  /** Gifts held: a lucky charm stops the next sickness, a sparkle treat helps the next form. */
  charms: number;
  sparkles: number;
  /** Set when the pet is gone; it keeps the stage and form it had, for the memory book. */
  cause: DeathCause | null;
};

export const METER_MAX = 100;

/** Phase 56: taps that crack an egg open, so a new pet is a few taps away, not a wait. */
export const EGG_TAPS = 5;

export const STAGE_MINUTES: Record<"egg" | "baby" | "child" | "teen", number> = {
  egg: 5,
  baby: 60,
  // A "care-day" is about the 6 awake hours of a default weekday.
  child: 6 * 60,
  teen: 3 * 6 * 60,
};

/** Adult lifespans by form, splendid first: about 20 down to 10 care-days. */
export const ADULT_LIFESPAN_MINUTES = [20, 16, 13, 10].map((days) => days * 6 * 60);

export const STAGE_WEIGHT: Record<Stage, number> = { egg: 0, baby: 5, child: 10, teen: 20, adult: 30 };

export function newEgg(species: Species, nowMinute: number): PetState {
  return {
    species,
    stage: "egg",
    form: 0,
    hunger: METER_MAX,
    fun: METER_MAX,
    energy: METER_MAX,
    discipline: 0,
    weight: STAGE_WEIGHT.egg,
    bond: 0,
    stageBond: 0,
    poops: 0,
    sick: false,
    dosesNeeded: 0,
    sickMinutes: 0,
    starvingMinutes: 0,
    call: null,
    quietUntil: nowMinute,
    careMistakes: 0,
    disciplineMistakes: 0,
    stageMinutes: 0,
    ageMinutes: 0,
    lifespanMinutes: 0,
    napUntil: nowMinute,
    lastAwakeMinute: nowMinute,
    recentSnacks: [],
    recentPets: [],
    charms: 0,
    sparkles: 0,
    cause: null,
  };
}

export function clampMeter(value: number): number {
  return Math.max(0, Math.min(METER_MAX, value));
}

/** Meters as the classic hearts (0–4), for the screen and for screen readers. */
export function hearts(meter: number): number {
  return Math.ceil(clampMeter(meter) / 25);
}

export function isAlive(state: PetState): boolean {
  return state.cause === null;
}

export function isHatched(state: PetState): boolean {
  return state.stage !== "egg" && isAlive(state);
}
