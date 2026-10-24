import { describe, expect, it } from "vitest";
import { BEHAVIOR_KINDS } from "./behavior";
import { durationOf, moodFor, poseFor, spotOfDecor } from "./motion";

const calm = { sick: false, call: null, hunger: 80, fun: 80 };

describe("how behaviors look", () => {
  it("stands beside a floor decoration and under one up high, never off the floor's ends", () => {
    expect(spotOfDecor([{ itemId: "cushion", surface: "floor", x: 62, y: 228 }], "cushion")).toBeGreaterThan(15);
    expect(spotOfDecor([{ itemId: "plant", surface: "sill", x: 200, y: 104 }], "plant")).toBe(50);
    expect(spotOfDecor([{ itemId: "lamp", surface: "shelf", x: 360, y: 93 }], "lamp")).toBeLessThanOrEqual(80);
    expect(spotOfDecor([], "nowhere")).toBe(45);
  });

  it("gives every behavior a pose and a duration", () => {
    for (const kind of BEHAVIOR_KINDS) {
      expect(poseFor({ kind })).toBeTruthy();
      expect(durationOf({ kind })).toBeGreaterThanOrEqual(3000);
    }
  });

  it("puts on the face that fits", () => {
    expect(moodFor({ kind: "sleep" }, calm)).toBe("asleep");
    expect(moodFor({ kind: "wander" }, { ...calm, sick: true })).toBe("sick");
    expect(moodFor({ kind: "call" }, { ...calm, call: "fake" })).toBe("excited");
    expect(moodFor({ kind: "call" }, { ...calm, call: "hunger" })).toBe("sad");
    expect(moodFor({ kind: "wander" }, { ...calm, hunger: 10 })).toBe("sad");
    expect(moodFor({ kind: "wander" }, calm)).toBe("happy");
    expect(moodFor({ kind: "wander" }, { ...calm, fun: 50 })).toBe("content");
  });
});
