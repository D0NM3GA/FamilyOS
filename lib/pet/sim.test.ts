import { describe, expect, it } from "vitest";
import { MINUTE_MS, type CareHours } from "./care-hours";
import { advance, CALL_WINDOW_MINUTES, hatchNow, pickForm, SICK_LIMIT_MINUTES, STARVE_LIMIT_MINUTES, type AdvanceContext } from "./sim";
import { ADULT_LIFESPAN_MINUTES, newEgg, STAGE_MINUTES, type PetState } from "./state";

const ALWAYS: CareHours = { weekday: [{ start: 0, end: 1440 }], weekend: [{ start: 0, end: 1440 }] };
const NEVER: CareHours = { weekday: [], weekend: [] };
const ctx = (careHours: CareHours = ALWAYS, timeZone = "UTC"): AdvanceContext => ({ seed: "pet-1", careHours, timeZone });

// Monday 2026-10-19 00:00 UTC.
const MONDAY = Date.UTC(2026, 9, 19);
const at = (minutes: number) => MONDAY + minutes * MINUTE_MS;
const startMinute = MONDAY / MINUTE_MS;

function baby(overrides: Partial<PetState> = {}): PetState {
  return { ...newEgg("blob", startMinute), stage: "baby", ...overrides };
}

describe("advance", () => {
  it("hatches an egg on wall-clock time, even while the pet would be asleep", () => {
    const { state, events } = advance(newEgg("bird", startMinute), at(0), at(STAGE_MINUTES.egg), ctx(NEVER));
    expect(state.stage).toBe("baby");
    expect(events.map((event) => event.kind)).toEqual(["hatched"]);
  });

  it("hatches an egg tapped open straight away, a fresh baby that's wide awake", () => {
    const { state, events } = hatchNow(newEgg("critter", startMinute), startMinute + 1);
    expect(state).toMatchObject({ stage: "baby", stageMinutes: 0, napUntil: startMinute + 1, lastAwakeMinute: startMinute + 1 });
    expect(events).toEqual([{ minute: startMinute + 1, kind: "hatched", stage: "baby", form: 0 }]);
    // Then it lives on from there like any other baby, never hatching twice.
    const later = advance(state, at(1), at(10), ctx());
    expect(later.events.some((event) => event.kind === "hatched")).toBe(false);
    expect(later.state.stage).toBe("baby");
  });

  it("leaves a pet that already hatched as it is", () => {
    const already = baby();
    expect(hatchNow(already, startMinute).state).toBe(already);
    expect(hatchNow({ ...newEgg("blob", startMinute), cause: "hunger" }, startMinute).state.stage).toBe("egg");
  });

  it("keeps an egg an egg until its time", () => {
    const { state } = advance(newEgg("bird", startMinute), at(0), at(3), ctx());
    expect(state).toMatchObject({ stage: "egg", stageMinutes: 3 });
  });

  it("ends the same whether caught up in one go or in pieces", () => {
    const whole = advance(newEgg("blob", startMinute), at(0), at(3 * 24 * 60), ctx());
    let split = newEgg("blob", startMinute);
    const cuts = [0, 1, 7, 64, 65, 300, 1000, 1001, 2500, 3 * 24 * 60];
    const events = [];
    for (let i = 1; i < cuts.length; i++) {
      const step = advance(split, at(cuts[i - 1]), at(cuts[i]), ctx());
      split = step.state;
      events.push(...step.events);
    }
    expect(split).toEqual(whole.state);
    expect(events).toEqual(whole.events);
  });

  it("changes nothing outside care hours", () => {
    const pet = baby({ hunger: 60, fun: 60, lastAwakeMinute: startMinute });
    const { state, events } = advance(pet, at(0), at(6 * 60), ctx(NEVER));
    expect(state).toEqual(pet);
    expect(events).toEqual([]);
  });

  it("drains hunger and fun while awake", () => {
    const { state } = advance(baby({ lastAwakeMinute: startMinute }), at(0), at(10), ctx());
    expect(state.hunger).toBe(90);
    expect(state.fun).toBe(90);
    expect(state.ageMinutes).toBe(10);
  });

  it("wakes rested after a night's sleep", () => {
    const pet = baby({ energy: 20, lastAwakeMinute: startMinute - 8 * 60 });
    const { state, events } = advance(pet, at(0), at(1), ctx());
    expect(events[0].kind).toBe("woke");
    expect(state.energy).toBeGreaterThan(99);
  });

  it("naps when it runs out of energy, and gets it back", () => {
    const pet = baby({ energy: 15, lastAwakeMinute: startMinute });
    const { state, events } = advance(pet, at(0), at(20), ctx());
    expect(events.some((event) => event.kind === "napped")).toBe(true);
    expect(state.energy).toBeGreaterThan(30);
  });

  it("counts a call missed for 15 minutes as a care mistake, then waits before calling again", () => {
    const pet = baby({ hunger: 0, lastAwakeMinute: startMinute });
    const { state, events } = advance(pet, at(0), at(CALL_WINDOW_MINUTES + 1), ctx());
    expect(events.filter((event) => event.kind === "called")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "missed-call")).toHaveLength(1);
    expect(state.careMistakes).toBe(1);
    expect(state.call).toBeNull();
    expect(state.quietUntil).toBeGreaterThan(startMinute + CALL_WINDOW_MINUTES);
  });

  it("counts an ignored fake call as a discipline mistake", () => {
    const pet = baby({ stage: "child", call: { kind: "fake", since: startMinute }, lastAwakeMinute: startMinute });
    const { state } = advance(pet, at(0), at(CALL_WINDOW_MINUTES + 1), ctx());
    expect(state.disciplineMistakes).toBe(1);
    expect(state.careMistakes).toBe(0);
  });

  it("starves after hours with an empty hunger meter", () => {
    const pet = baby({ hunger: 0, starvingMinutes: STARVE_LIMIT_MINUTES - 1, lastAwakeMinute: startMinute });
    const { state, events } = advance(pet, at(0), at(5), ctx());
    expect(state).toMatchObject({ stage: "baby", cause: "hunger", call: null });
    expect(events.at(-1)?.kind).toBe("gone");
  });

  it("is lost to sickness left untreated", () => {
    const pet = baby({ sick: true, dosesNeeded: 1, sickMinutes: SICK_LIMIT_MINUTES - 1, lastAwakeMinute: startMinute });
    expect(advance(pet, at(0), at(1), ctx()).state).toMatchObject({ stage: "baby", cause: "sickness" });
  });

  it("lives out an adult's lifespan, then goes of old age", () => {
    const lifespanMinutes = ADULT_LIFESPAN_MINUTES[0];
    const pet = baby({ stage: "adult", lifespanMinutes, stageMinutes: lifespanMinutes - 1, lastAwakeMinute: startMinute });
    expect(advance(pet, at(0), at(1), ctx()).state).toMatchObject({ stage: "adult", cause: "old-age" });
  });

  it("does nothing once the pet is gone", () => {
    const pet = baby({ cause: "hunger" });
    expect(advance(pet, at(0), at(600), ctx()).state).toEqual(pet);
  });

  it("grows up and starts the next stage's mistakes afresh", () => {
    const pet = baby({ stageMinutes: STAGE_MINUTES.baby - 1, careMistakes: 3, lastAwakeMinute: startMinute });
    const { state, events } = advance(pet, at(0), at(1), ctx());
    expect(state).toMatchObject({ stage: "child", form: 1, careMistakes: 0, stageMinutes: 0 });
    expect(events.map((event) => event.kind)).toContain("grew");
  });

  it("says what it grew into, for every growth in a catch-up", () => {
    const { events } = advance(newEgg("bird", startMinute), at(0), at(STAGE_MINUTES.egg + STAGE_MINUTES.baby + 1), ctx());
    const growth = events.filter((event) => event.kind === "hatched" || event.kind === "grew");
    expect(growth.map(({ stage, form }) => ({ stage, form }))).toEqual([
      { stage: "baby", form: 0 },
      { stage: "child", form: expect.any(Number) },
    ]);
  });

  it("sets a lifespan when it grows into an adult", () => {
    const pet = baby({ stage: "teen", stageMinutes: STAGE_MINUTES.teen - 1, discipline: 100, lastAwakeMinute: startMinute });
    const { state } = advance(pet, at(0), at(1), ctx());
    expect(state).toMatchObject({ stage: "adult", form: 0, lifespanMinutes: ADULT_LIFESPAN_MINUTES[0] });
  });

  it("uses a lucky charm before getting sick", () => {
    const pet = baby({ stage: "adult", lifespanMinutes: 100_000, charms: 1, poops: 4, lastAwakeMinute: startMinute });
    const { events } = advance(pet, at(0), at(3000), ctx());
    const kinds = events.map((event) => event.kind).filter((kind) => kind === "charm-saved" || kind === "got-sick");
    expect(kinds[0]).toBe("charm-saved");
    expect(kinds.filter((kind) => kind === "charm-saved")).toHaveLength(1);
  });
});

describe("pickForm", () => {
  const stats = (overrides: Partial<PetState>) => baby({ discipline: 100, ...overrides });

  it("picks the splendid form for a pet with no mistakes", () => {
    expect(pickForm("adult", stats({}))).toBe(0);
  });

  it("picks scruffier forms as mistakes add up", () => {
    expect(pickForm("adult", stats({ careMistakes: 1 }))).toBe(1);
    expect(pickForm("adult", stats({ careMistakes: 2, disciplineMistakes: 1 }))).toBe(2);
    expect(pickForm("adult", stats({ careMistakes: 5 }))).toBe(3);
    expect(pickForm("teen", stats({ careMistakes: 9 }))).toBe(2);
  });

  it("counts low discipline as a mistake", () => {
    expect(pickForm("adult", stats({ discipline: 25 }))).toBe(1);
  });

  it("forgives a mistake for a strong bond or a sparkle treat", () => {
    expect(pickForm("adult", stats({ careMistakes: 1, disciplineMistakes: 0, stageBond: 20, sparkles: 1 }))).toBe(0);
  });

  it("has one form for stages without a choice", () => {
    expect(pickForm("baby", stats({ careMistakes: 9 }))).toBe(0);
  });
});

describe("a long time away", () => {
  it("stops catching up once the pet is gone, however long the gap", () => {
    const pet = { ...newEgg("blob", startMinute), stage: "baby" as const, hunger: 0, starvingMinutes: STARVE_LIMIT_MINUTES - 1, lastAwakeMinute: startMinute };
    const started = performance.now();
    const { state } = advance(pet, at(0), at(5 * 365 * 24 * 60), ctx());
    expect(state.cause).toBe("hunger");
    // Five years of minutes would take seconds to list; stopping early takes a moment.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
