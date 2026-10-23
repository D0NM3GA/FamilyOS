import { z } from "zod";
import { DEFAULT_CARE_HOURS, isWholeHourWindow, type CareHours } from "./care-hours";
import { SPECIES, STAGES, type PetState } from "./state";

/**
 * Phase 47: reading what the database keeps. `Pet.state` and `Household.petCareHours` are
 * JSON, so they're checked here on the way out of the database rather than trusted. Pure.
 */

const minute = z.number().int();
const meter = z.number().min(0).max(100);
const count = z.number().int().min(0);

const petStateSchema = z.object({
  species: z.enum(SPECIES),
  stage: z.enum(STAGES),
  form: count,
  hunger: meter,
  fun: meter,
  energy: meter,
  discipline: meter,
  weight: z.number().min(0),
  bond: count,
  stageBond: count,
  poops: count,
  sick: z.boolean(),
  dosesNeeded: count,
  sickMinutes: count,
  starvingMinutes: count,
  call: z.object({ kind: z.enum(["hunger", "fun", "sick", "fake"]), since: minute }).nullable(),
  quietUntil: minute,
  careMistakes: count,
  disciplineMistakes: count,
  stageMinutes: count,
  ageMinutes: count,
  lifespanMinutes: count,
  napUntil: minute,
  lastAwakeMinute: minute,
  // Only the newest few matter; trimming instead of refusing keeps an odd list from breaking a pet.
  recentSnacks: z.array(minute).transform((list) => list.slice(-10)),
  recentPets: z.array(minute).transform((list) => list.slice(-10)),
  charms: count,
  sparkles: count,
  cause: z.enum(["hunger", "sickness", "old-age"]).nullable(),
}) satisfies z.ZodType<PetState, unknown>;

/** The kept state, or null if it isn't one (a hand edit, or a shape from a later version). */
export function readPetState(json: unknown): PetState | null {
  const parsed = petStateSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const windows = z.array(z.object({ start: minute, end: minute }).refine(isWholeHourWindow)).max(4);
const careHoursSchema = z.object({ weekday: windows, weekend: windows });

/** A household's care hours, or the defaults when none are set or they can't be used. */
export function readCareHours(json: unknown): CareHours {
  const parsed = careHoursSchema.safeParse(json);
  return parsed.success ? parsed.data : DEFAULT_CARE_HOURS;
}

/**
 * Care hours from the Settings form: for weekdays and weekends, up to two windows, each a
 * "from" and "to" hour (0–24) or left off. Windows that are off, empty or backwards are
 * dropped; an all-off day means the pets sleep all day then.
 */
export function careHoursFromForm(read: (name: string) => unknown): CareHours {
  const windowsFor = (day: "weekday" | "weekend") =>
    [0, 1].flatMap((i) => {
      const from = Number(read(`${day}-${i}-from`));
      const to = Number(read(`${day}-${i}-to`));
      const window = { start: from * 60, end: to * 60 };
      return Number.isInteger(from) && Number.isInteger(to) && read(`${day}-${i}-from`) !== "" && isWholeHourWindow(window) ? [window] : [];
    });
  return { weekday: windowsFor("weekday"), weekend: windowsFor("weekend") };
}
