import { describe, expect, it } from "vitest";
import { nextBehavior, type BehaviorInput, type RoomView } from "./behavior";
import { personalityFromSeed, type Personality } from "./personality";
import { rngFor } from "./random";

const pet = (overrides: Partial<BehaviorInput> = {}): BehaviorInput => ({ stage: "child", sick: false, fun: 50, energy: 80, napping: false, calling: false, ...overrides });
const bareRoom: RoomView = { toysOut: [], decor: [], weather: "clear" };
const calm: Personality = { favoriteToy: "ball", favoriteFood: "berries", favoriteSpot: "head", quirk: "sleepy" };

function sample(state: BehaviorInput, personality: Personality, room: RoomView, count = 400) {
  return Array.from({ length: count }, (_, i) => nextBehavior(state, personality, room, true, rngFor("s", i)));
}

describe("nextBehavior", () => {
  it("wobbles as an egg and sleeps when it's not awake", () => {
    expect(nextBehavior(pet({ stage: "egg" }), calm, bareRoom, true, rngFor("s")).kind).toBe("wobble");
    expect(nextBehavior(pet(), calm, bareRoom, false, rngFor("s"))).toEqual({ kind: "sleep", target: "bed" });
  });

  it("naps on a cushion if the room has one", () => {
    const room = { ...bareRoom, decor: ["plant", "cushion"] };
    expect(nextBehavior(pet({ napping: true }), calm, room, true, rngFor("s"))).toEqual({ kind: "sleep", target: "cushion" });
  });

  it("lies down when sick and calls when it needs something", () => {
    expect(nextBehavior(pet({ sick: true }), calm, bareRoom, true, rngFor("s")).kind).toBe("lie-down");
    expect(nextBehavior(pet({ calling: true }), calm, bareRoom, true, rngFor("s")).kind).toBe("call");
  });

  it("picks the same thing for the same dice", () => {
    const room = { ...bareRoom, toysOut: ["drum", "ball"] as const, decor: ["lamp"] };
    expect(nextBehavior(pet(), calm, room, true, rngFor("x", 3))).toEqual(nextBehavior(pet(), calm, room, true, rngFor("x", 3)));
  });

  it("only plays with toys and decorations that are in the room", () => {
    const kinds = new Set(sample(pet(), { ...calm, quirk: "shy" }, bareRoom).map((behavior) => behavior.kind));
    expect(kinds.has("play-toy")).toBe(false);
    expect(kinds.has("sniff")).toBe(false);
    expect(kinds.has("peek")).toBe(false);
    const room: RoomView = { toysOut: ["drum"], decor: ["plant"], weather: "clear" };
    for (const behavior of sample(pet(), calm, room)) {
      if (behavior.kind === "play-toy") expect(behavior.target).toBe("drum");
      if (behavior.kind === "sniff") expect(behavior.target).toBe("plant");
    }
  });

  it("goes for its favorite toy more than the others", () => {
    const room: RoomView = { toysOut: ["drum", "ball", "kite"], decor: [], weather: "clear" };
    const toys = sample(pet(), calm, room, 2000).filter((behavior) => behavior.kind === "play-toy");
    const favorite = toys.filter((behavior) => behavior.target === "ball").length;
    expect(favorite).toBeGreaterThan(toys.length / 2);
  });

  it("sulks only when bored and dances only when happy", () => {
    expect(sample(pet({ fun: 90 }), calm, bareRoom).some((behavior) => behavior.kind === "sulk")).toBe(false);
    expect(sample(pet({ fun: 10 }), calm, bareRoom).some((behavior) => behavior.kind === "dance")).toBe(false);
    expect(sample(pet({ fun: 10 }), calm, bareRoom).some((behavior) => behavior.kind === "sulk")).toBe(true);
  });
});

describe("personalityFromSeed", () => {
  it("is fixed for a seed and varies between pets", () => {
    expect(personalityFromSeed("pet-a")).toEqual(personalityFromSeed("pet-a"));
    const quirks = new Set(Array.from({ length: 40 }, (_, i) => personalityFromSeed(`pet-${i}`).quirk));
    expect(quirks.size).toBeGreaterThan(1);
  });
});
