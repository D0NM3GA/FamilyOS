// Discrete, physical hop-based chase locomotion — replaces a continuous eased
// glide (which read as "sliding on ice") with a sequence of real hops: launch,
// airborne arc, land, brief pause, re-aim, hop again. The cursor's position is
// only sampled at the start of each hop (see planHop) — never mid-flight —
// which is what makes him look like he's chasing rather than tracking: a
// cursor that moves wildly gets chased but never caught.
//
// The frame art itself (components/bunson.tsx's LOCO_FRAMES, bunson-loco-*.png)
// is a distinct clip generated to face and lean into the direction of travel —
// not the click-triggered "excited hop" in lib/bunson-hop.ts, which is a
// camera-facing jump-in-place. Reusing that jump for sideways travel was an
// earlier iteration and is exactly what read as unphysical; keep these two
// clips separate.
export const LOCO_FRAME_COUNT = 8;
export const LOCO_FRAME_MS = 60; // frame cadence
export const LOCO_HOP_MS = LOCO_FRAME_COUNT * LOCO_FRAME_MS; // 480

// Horizontal-translation window within one hop cycle. Originally measured
// against the jump-in-place art's own airborne frames (feet leaving/landing
// on the ground line); LOCO_FRAMES's actual bounding-gait art keeps all feet
// near the ground line throughout, so these values are now a stylistic
// choice (when during the cycle he visibly displaces) rather than a
// measurement — re-tune by eye if the loco art changes, don't re-derive from
// a bbox scan.
const AIR_START_MS = 120;
const AIR_END_MS = 360;

export const HOP_BEAT_MS = 120; // pause on the landing pose before the next launch
// Full cycle (hop + beat) is LOCO_HOP_MS + HOP_BEAT_MS = 600ms, ~1.7 hops/sec —
// a relaxed cadence for a small rabbit.

// One relaxed hop covers roughly a body length; below the dead zone a "hop"
// would just be jitter, so the final approach snaps to exactly the remaining
// distance instead of a fixed-size hop (which would overshoot and oscillate).
export const HOP_MIN_PX = 16;
export const HOP_MAX_PX = 60;
export const ARRIVE_PX = 8; // close enough to stop — see planHop's no-oscillation note

// Given a signed remaining distance to the target, decide the next hop:
// null means "close enough, stop" (arrived). Otherwise returns a signed
// distance clamped to [HOP_MIN_PX, HOP_MAX_PX] in the direction of travel.
// Invariant: ARRIVE_PX >= HOP_MIN_PX / 2 guarantees this never oscillates
// forever — the worst-case overshoot after a minimum-sized hop is
// (HOP_MIN_PX - ARRIVE_PX), which is itself <= ARRIVE_PX, so the next call
// arrives.
export function planHop(remainingPx: number): number | null {
  const abs = Math.abs(remainingPx);
  if (abs <= ARRIVE_PX) return null;
  const dist = Math.min(Math.max(abs, HOP_MIN_PX), HOP_MAX_PX);
  return Math.sign(remainingPx) * dist;
}

// Frame index (0-7) for a hop cycle at this elapsed time, or null once the
// hop has landed and the between-hop beat has begun (elapsed >= LOCO_HOP_MS).
export function locoFrameIndex(elapsedMs: number): number | null {
  if (elapsedMs >= LOCO_HOP_MS) return null;
  const clamped = Math.max(0, elapsedMs);
  return Math.floor(clamped / LOCO_FRAME_MS) % LOCO_FRAME_COUNT;
}

// Linear horizontal progress (0-1) through the airborne window of one hop.
// Constant velocity in flight — an eased curve would look like braking
// mid-air, which is exactly the non-physical quality this replaces.
export function hopProgress(elapsedMs: number): number {
  if (elapsedMs <= AIR_START_MS) return 0;
  if (elapsedMs >= AIR_END_MS) return 1;
  return (elapsedMs - AIR_START_MS) / (AIR_END_MS - AIR_START_MS);
}
