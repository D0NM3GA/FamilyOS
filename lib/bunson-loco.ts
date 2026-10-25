// Discrete, physical hop-based chase locomotion — replaces a continuous eased
// glide (which read as "sliding on ice") with a sequence of real hops: launch,
// airborne arc, land, brief pause, re-aim, hop again. The cursor's position is
// only sampled at the start of each hop (see planHop) — never mid-flight —
// which is what makes him look like he's chasing rather than tracking: a
// cursor that moves wildly gets chased but never caught.
//
// The frame art itself (components/bunson.tsx's LOCO_FRAMES, bunson-loco-*.png)
// is one side-on bunny hop drawn in place: crouch, push off with both hind
// legs, stretch out in the air, land front paws first, hind legs swing under,
// back to the same crouch. It starts and ends on that crouch, so hops chain
// without a jump in the pose. Not the click-triggered "excited hop" in
// lib/bunson-hop.ts, which is a camera-facing jump-in-place; keep the two
// clips separate.
export const LOCO_FRAME_COUNT = 16;
export const LOCO_FRAME_MS = 30; // frame cadence: about 33 frames a second
export const LOCO_HOP_MS = LOCO_FRAME_COUNT * LOCO_FRAME_MS; // 480

// When he's moving forward, measured from the art: frames 0-2 are the crouch
// gathering, he pushes off on 3, is airborne 4-7, lands front-first on 8 and
// draws his hind legs under by 12; 13-15 settle into the crouch again.
export const AIR_START_MS = 3 * LOCO_FRAME_MS;
// How far each frame's art already lifts his feet off the ground line (px),
// measured from bunson-loco-*.png; the shadow adds this to the arc.
export const LOCO_FRAME_LIFT_PX: readonly number[] = [0, 0, 0, 0, 4, 6, 6, 3, 1, 1, 1, 1, 1, 0, 0, 0];
export const AIR_END_MS = 13 * LOCO_FRAME_MS;

export const HOP_BEAT_MS = 40; // a short settle on the crouch before the next launch
// Full cycle (hop + beat) is 520ms, about two hops a second: brisk, and the
// crouch at both ends keeps it one continuous bounce.

// The art lifts him about 7px at the top of the hop. Longer hops get a little
// more height on top of that, as a real rabbit would: a parabola over the air
// window, its peak growing with the hop's length up to HOP_LIFT_MAX_PX.
export const HOP_LIFT_MAX_PX = 6;
const LIFT_PER_PX = 0.1;

// Once he arrives he stays side-on in his crouch for a moment before turning
// to face you, instead of snapping round mid-landing.
export const SETTLE_MS = 600;

// Reversing direction: he turns through a three-quarter view (facing the old
// way, then mirrored to face the new way) instead of flipping in one frame.
export const TURN_STEP_MS = 70;
export const TURN_MS = 2 * TURN_STEP_MS;

// Which way to show the three-quarter pose this far into a turn: the old
// direction for the first step, the new one for the second; null once done.
export function turnFacing(elapsedMs: number, from: 1 | -1): 1 | -1 | null {
  if (elapsedMs >= TURN_MS) return null;
  return elapsedMs < TURN_STEP_MS ? from : (-from as 1 | -1);
}

// The ground shadow: full size and strength on the ground, smaller and
// fainter the higher he is (art lift + arc), so the lift reads as leaving the
// ground rather than sliding up. Scale and opacity, both 0-1.
export const SHADOW_FADE_PX = 24;
export function shadowAt(liftPx: number): { scale: number; opacity: number } {
  const k = Math.min(Math.max(liftPx, 0) / SHADOW_FADE_PX, 1);
  return { scale: 1 - 0.45 * k, opacity: 1 - 0.6 * k };
}

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

// Extra height (px, positive is up) at this point of a hop of this length.
export function hopLiftPx(elapsedMs: number, hopPx: number): number {
  if (elapsedMs <= AIR_START_MS || elapsedMs >= AIR_END_MS) return 0;
  const t = (elapsedMs - AIR_START_MS) / (AIR_END_MS - AIR_START_MS);
  const peak = Math.min(HOP_LIFT_MAX_PX, Math.abs(hopPx) * LIFT_PER_PX);
  return 4 * peak * t * (1 - t);
}

// Linear horizontal progress (0-1) through the airborne window of one hop.
// Constant velocity in flight — an eased curve would look like braking
// mid-air, which is exactly the non-physical quality this replaces.
export function hopProgress(elapsedMs: number): number {
  if (elapsedMs <= AIR_START_MS) return 0;
  if (elapsedMs >= AIR_END_MS) return 1;
  return (elapsedMs - AIR_START_MS) / (AIR_END_MS - AIR_START_MS);
}
