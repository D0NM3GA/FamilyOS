import { describe, expect, it } from "vitest";
import { clean, feedMeal, feedSnack, giveMedicine, petIt, play, PETS_PER_HOUR, sayNo, SNACKS_BEFORE_SICK } from "./care";
import { newEgg, type PetState } from "./state";

const pet = (overrides: Partial<PetState> = {}): PetState => ({ ...newEgg("blob", 0), stage: "child", ...overrides });

describe("care", () => {
  it("can't care for an egg yet", () => {
    expect(feedMeal(newEgg("blob", 0)).outcome).toBe("not-hatched");
  });

  it("feeds a hungry pet and answers its call with extra bond", () => {
    const { state, outcome } = feedMeal(pet({ hunger: 0, call: { kind: "hunger", since: 0 } }));
    expect(outcome).toBe("ok");
    expect(state).toMatchObject({ hunger: 25, call: null, bond: 3, stageBond: 3 });
  });

  it("won't eat when full", () => {
    expect(feedMeal(pet()).outcome).toBe("full");
  });

  it("gets a tummy ache from too many snacks in a row", () => {
    let state = pet({ fun: 0 });
    for (let i = 0; i < SNACKS_BEFORE_SICK; i++) state = feedSnack(state, i).state;
    const result = feedSnack(state, SNACKS_BEFORE_SICK);
    expect(result.outcome).toBe("too-many-snacks");
    expect(result.state.sick).toBe(true);
  });

  it("says no to snacks while sick, and keeps its snack list short", () => {
    expect(feedSnack(pet({ sick: true, dosesNeeded: 1 }), 0).outcome).toBe("too-many-snacks");
    let state = pet({ charms: 99 });
    for (let i = 0; i < 50; i++) state = feedSnack(state, i % 5).state;
    expect(state.recentSnacks.length).toBeLessThanOrEqual(SNACKS_BEFORE_SICK + 1);
  });

  it("lets a lucky charm stop a tummy ache", () => {
    let state = pet({ charms: 1 });
    for (let i = 0; i <= SNACKS_BEFORE_SICK; i++) state = feedSnack(state, i).state;
    expect(state).toMatchObject({ sick: false, charms: 0 });
  });

  it("forgets snacks from more than half an hour ago", () => {
    let state = pet();
    for (let i = 0; i < SNACKS_BEFORE_SICK; i++) state = feedSnack(state, i).state;
    expect(feedSnack(state, 60).outcome).toBe("ok");
  });

  it("cleans up poop", () => {
    expect(clean(pet({ poops: 3 })).state.poops).toBe(0);
    expect(clean(pet()).outcome).toBe("nothing-to-clean");
  });

  it("cures sickness over the doses it needs", () => {
    const first = giveMedicine(pet({ sick: true, dosesNeeded: 2 }));
    expect(first.outcome).toBe("still-sick");
    const second = giveMedicine(first.state);
    expect(second.outcome).toBe("cured");
    expect(second.state.sick).toBe(false);
    expect(giveMedicine(second.state).outcome).toBe("not-sick");
  });

  it("raises discipline for a No to a fake call, and is confused by a No to a real one", () => {
    const fake = sayNo(pet({ call: { kind: "fake", since: 0 } }));
    expect(fake.state).toMatchObject({ discipline: 25, call: null });
    expect(sayNo(pet({ call: { kind: "hunger", since: 0 } })).outcome).toBe("confused");
    expect(sayNo(pet()).outcome).toBe("nothing-to-scold");
  });

  it("loves its favorite petting spot, and wriggles away after too much", () => {
    expect(petIt(pet({ fun: 0 }), 0, false).state.fun).toBe(10);
    expect(petIt(pet({ fun: 0 }), 0, true).state.fun).toBe(20);
    let state = pet({ fun: 0 });
    for (let i = 0; i < PETS_PER_HOUR; i++) state = petIt(state, i, false).state;
    expect(petIt(state, PETS_PER_HOUR, false).outcome).toBe("wriggled");
    expect(petIt(state, 61, false).outcome).toBe("ok");
  });

  it("plays when it has the energy, and not when it's sick or tired", () => {
    const { state, outcome } = play(pet({ fun: 0, poops: 2 }), { fun: 30, clean: true, energy: 10 });
    expect(outcome).toBe("ok");
    expect(state).toMatchObject({ fun: 30, poops: 0, energy: 90 });
    expect(play(pet({ energy: 5 }), { fun: 30, energy: 10 }).outcome).toBe("too-tired");
    expect(play(pet({ sick: true }), { fun: 30, energy: 10 }).outcome).toBe("too-tired");
  });

  it("never lowers bond", () => {
    const start = pet({ bond: 7, hunger: 0, poops: 1, call: { kind: "fake", since: 0 } });
    const results = [feedMeal(start), feedSnack(start, 0), clean(start), giveMedicine(start), sayNo(start), petIt(start, 0, false)];
    for (const { state } of results) expect(state.bond).toBeGreaterThanOrEqual(7);
  });
});
