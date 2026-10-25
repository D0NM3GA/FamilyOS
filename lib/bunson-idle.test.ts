import { describe, expect, it } from "vitest";
import { IDLE_LIFE_FRAME_COUNT, IDLE_LIFE_MAX_GAP_MS, IDLE_LIFE_MIN_GAP_MS, IDLE_LIFE_MS, idleLifeFrameIndex, idleLifeGap } from "./bunson-idle";

describe("idle life", () => {
  it("waits between the min and max gap, whatever the random number", () => {
    expect(idleLifeGap(0)).toBe(IDLE_LIFE_MIN_GAP_MS);
    expect(idleLifeGap(1)).toBe(IDLE_LIFE_MAX_GAP_MS);
    expect(idleLifeGap(-3)).toBe(IDLE_LIFE_MIN_GAP_MS);
    expect(idleLifeGap(7)).toBe(IDLE_LIFE_MAX_GAP_MS);
  });

  it("plays every frame once, then hands back to sitting", () => {
    expect(idleLifeFrameIndex(0)).toBe(0);
    expect(idleLifeFrameIndex(IDLE_LIFE_MS - 1)).toBe(IDLE_LIFE_FRAME_COUNT - 1);
    expect(idleLifeFrameIndex(IDLE_LIFE_MS)).toBeNull();
    expect(idleLifeFrameIndex(-10)).toBe(0);
  });
});
