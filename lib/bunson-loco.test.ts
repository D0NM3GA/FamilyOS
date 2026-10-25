import { describe, expect, it } from "vitest";
import {
  AIR_END_MS,
  AIR_START_MS,
  ARRIVE_PX,
  HOP_LIFT_MAX_PX,
  HOP_MAX_PX,
  HOP_MIN_PX,
  LOCO_FRAME_COUNT,
  LOCO_FRAME_LIFT_PX,
  LOCO_HOP_MS,
  TURN_MS,
  TURN_STEP_MS,
  hopLiftPx,
  hopProgress,
  locoFrameIndex,
  planHop,
  shadowAt,
  turnFacing,
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

  it("holds the last frame for the last frame slot before landing", () => {
    expect(locoFrameIndex(LOCO_HOP_MS - 1)).toBe(LOCO_FRAME_COUNT - 1);
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
    expect(hopProgress(AIR_START_MS)).toBe(0);
    expect(hopProgress(AIR_END_MS)).toBe(1);
  });

  it("is 0 before takeoff and 1 after landing", () => {
    expect(hopProgress(0)).toBe(0);
    expect(hopProgress(1000)).toBe(1);
  });

  it("is linear through the airborne window", () => {
    expect(hopProgress((AIR_START_MS + AIR_END_MS) / 2)).toBeCloseTo(0.5, 5);
  });

  it("finishes moving before the last frame, so he lands where the crouch is drawn", () => {
    expect(AIR_END_MS).toBeLessThanOrEqual(LOCO_HOP_MS);
  });
});

describe("hopLiftPx", () => {
  const mid = (AIR_START_MS + AIR_END_MS) / 2;
  it("is on the ground at both ends of the air window", () => {
    expect(hopLiftPx(AIR_START_MS, 60)).toBe(0);
    expect(hopLiftPx(AIR_END_MS, 60)).toBe(0);
    expect(hopLiftPx(0, 60)).toBe(0);
  });

  it("peaks mid-air, higher for longer hops, never past the cap", () => {
    expect(hopLiftPx(mid, 20)).toBeCloseTo(2, 5);
    expect(hopLiftPx(mid, 60)).toBeCloseTo(HOP_LIFT_MAX_PX, 5);
    expect(hopLiftPx(mid, 1000)).toBe(HOP_LIFT_MAX_PX);
    expect(hopLiftPx(mid, -40)).toBeCloseTo(4, 5);
  });
});

describe("turnFacing", () => {
  it("shows the old way, then the new way, then hands back", () => {
    expect(turnFacing(0, 1)).toBe(1);
    expect(turnFacing(TURN_STEP_MS, 1)).toBe(-1);
    expect(turnFacing(TURN_STEP_MS, -1)).toBe(1);
    expect(turnFacing(TURN_MS, 1)).toBeNull();
  });
});

describe("shadowAt", () => {
  it("is full on the ground and shrinks and fades with height, never vanishing", () => {
    expect(shadowAt(0)).toEqual({ scale: 1, opacity: 1 });
    const up = shadowAt(12);
    expect(up.scale).toBeLessThan(1);
    expect(up.opacity).toBeLessThan(1);
    expect(shadowAt(1000)).toEqual(shadowAt(24));
    expect(shadowAt(1000).opacity).toBeGreaterThan(0);
    expect(shadowAt(-5)).toEqual({ scale: 1, opacity: 1 });
  });
});

describe("the hop art's measurements", () => {
  it("gives every frame a lift, on the ground at both ends", () => {
    expect(LOCO_FRAME_LIFT_PX).toHaveLength(LOCO_FRAME_COUNT);
    expect(LOCO_FRAME_LIFT_PX[0]).toBe(0);
    expect(LOCO_FRAME_LIFT_PX[LOCO_FRAME_COUNT - 1]).toBe(0);
  });
});
