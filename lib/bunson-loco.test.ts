import { describe, expect, it } from "vitest";
import {
  ARRIVE_PX,
  HOP_MAX_PX,
  HOP_MIN_PX,
  LOCO_HOP_MS,
  hopProgress,
  locoFrameIndex,
  planHop,
} from "./bunson-loco";

describe("planHop", () => {
  it("arrives (null) within the dead zone", () => {
    expect(planHop(0)).toBeNull();
    expect(planHop(ARRIVE_PX)).toBeNull();
    expect(planHop(-ARRIVE_PX)).toBeNull();
  });

  it("clamps a small-but-outside-arrival remainder up to HOP_MIN_PX", () => {
    expect(planHop(ARRIVE_PX + 1)).toBe(HOP_MIN_PX);
    expect(planHop(-(ARRIVE_PX + 1))).toBe(-HOP_MIN_PX);
  });

  it("passes through an exact final-approach distance within range", () => {
    expect(planHop(40)).toBe(40);
    expect(planHop(-40)).toBe(-40);
  });

  it("clamps a large remainder down to HOP_MAX_PX", () => {
    expect(planHop(1000)).toBe(HOP_MAX_PX);
    expect(planHop(-1000)).toBe(-HOP_MAX_PX);
  });

  it("never oscillates: a minimum hop's worst-case overshoot is within ARRIVE_PX", () => {
    // Just outside the dead zone, hop is forced up to HOP_MIN_PX, which can
    // overshoot the target — but the overshoot must itself land back inside
    // the dead zone, or he'd hop back and forth forever.
    const remaining = ARRIVE_PX + 1;
    const hop = planHop(remaining)!;
    const overshoot = hop - remaining;
    expect(planHop(-overshoot)).toBeNull();
  });
});

describe("locoFrameIndex", () => {
  it("starts at frame 0", () => {
    expect(locoFrameIndex(0)).toBe(0);
  });

  it("holds frame 7 for the last frame slot before landing", () => {
    expect(locoFrameIndex(LOCO_HOP_MS - 1)).toBe(7);
  });

  it("resolves to idle (null) once the hop lands", () => {
    expect(locoFrameIndex(LOCO_HOP_MS)).toBeNull();
    expect(locoFrameIndex(LOCO_HOP_MS + 1000)).toBeNull();
  });

  it("clamps negative elapsed to frame 0", () => {
    expect(locoFrameIndex(-5)).toBe(0);
  });
});

describe("hopProgress", () => {
  it("is exactly 0 at the airborne window's start and 1 at its end", () => {
    expect(hopProgress(120)).toBe(0);
    expect(hopProgress(360)).toBe(1);
  });

  it("is 0 before takeoff and 1 after landing", () => {
    expect(hopProgress(0)).toBe(0);
    expect(hopProgress(1000)).toBe(1);
  });

  it("is linear through the airborne window", () => {
    expect(hopProgress(240)).toBeCloseTo(0.5, 5);
  });
});
