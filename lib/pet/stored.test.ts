import { describe, expect, it } from "vitest";
import { DEFAULT_CARE_HOURS } from "./care-hours";
import { careHoursFromForm, readCareHours, readPetState } from "./stored";
import { newEgg } from "./state";

describe("stored pet data", () => {
  it("reads a pet's state back, and refuses one that isn't", () => {
    const egg = newEgg("bird", 100);
    expect(readPetState(JSON.parse(JSON.stringify(egg)))).toEqual(egg);
    expect(readPetState({ ...egg, hunger: 400 })).toBeNull();
    expect(readPetState("nope")).toBeNull();
    // A long list from an older save is trimmed, not a reason to lose the pet.
    expect(readPetState({ ...egg, recentSnacks: Array.from({ length: 30 }, (_, i) => i) })?.recentSnacks).toHaveLength(10);
  });

  it("falls back to the default care hours for anything unusable", () => {
    expect(readCareHours(null)).toBe(DEFAULT_CARE_HOURS);
    expect(readCareHours({ weekday: [{ start: 90, end: 120 }], weekend: [] })).toBe(DEFAULT_CARE_HOURS);
    expect(readCareHours({ weekday: [], weekend: [{ start: 480, end: 1200 }] })).toEqual({ weekday: [], weekend: [{ start: 480, end: 1200 }] });
  });

  it("reads care hours from the settings form, dropping windows that are off or backwards", () => {
    const form: Record<string, string> = {
      "weekday-0-from": "7",
      "weekday-0-to": "8",
      "weekday-1-from": "15",
      "weekday-1-to": "20",
      "weekend-0-from": "20",
      "weekend-0-to": "8",
      "weekend-1-from": "",
      "weekend-1-to": "",
    };
    expect(careHoursFromForm((name) => form[name] ?? "")).toEqual({
      weekday: DEFAULT_CARE_HOURS.weekday,
      weekend: [],
    });
  });
});
