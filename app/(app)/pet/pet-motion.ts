import type { Behavior } from "@/lib/pet/behavior";
import type { RoomSlot } from "@/lib/pet/items";
import { hearts, type CallKind } from "@/lib/pet/state";
import { ROOM_W, SLOT_ANCHORS } from "./pet-room";
import type { Mood, Pose } from "./pet-sprite";

/**
 * Phase 47: how a behavior (lib/pet/behavior.ts) looks on screen: where the pet walks to, its
 * pose and face, and how long it keeps at it. Pure.
 */

/** Where things stand on the floor, as a percentage across the room. */
export const BED_X = 86;
export const WINDOW_X = 50;
export const TOY_SPOTS = [40, 56, 30, 70, 47];
const pct = (x: number) => (x / ROOM_W) * 100;

/** Where to stand to see a decoration: beside it on the floor, or under it if it's up high. */
export function spotOfDecor(decor: Partial<Record<RoomSlot, string>>, id: string): number {
  const slot = (Object.keys(decor) as RoomSlot[]).find((s) => decor[s] === id);
  if (!slot) return 45;
  const anchor = SLOT_ANCHORS[slot];
  return Math.min(80, Math.max(15, pct(anchor.x) + (slot.startsWith("floor") ? 10 : 0)));
}

export function poseFor(behavior: Behavior): Pose {
  switch (behavior.kind) {
    case "wobble":
      return "wobble";
    case "hop":
    case "play-toy":
    case "call":
      return "hop";
    case "dance":
      return "dance";
    case "sulk":
      return "droop";
    case "lie-down":
    case "sleep":
      return "lie";
    default:
      return "idle";
  }
}

export function moodFor(behavior: Behavior, pet: { sick: boolean; call: CallKind | null; hunger: number; fun: number }): Mood {
  if (behavior.kind === "sleep" || behavior.kind === "yawn") return "asleep";
  if (pet.sick) return "sick";
  if (behavior.kind === "dance" || behavior.kind === "play-toy") return "excited";
  if (behavior.kind === "sulk") return "sad";
  if (behavior.kind === "call") return pet.call === "fake" ? "excited" : "sad";
  if (hearts(pet.hunger) <= 1 || hearts(pet.fun) <= 1) return "sad";
  return hearts(pet.fun) >= 3 ? "happy" : "content";
}

/** How long each behavior lasts before the pet picks another, in milliseconds. */
export function durationOf(behavior: Behavior): number {
  switch (behavior.kind) {
    case "wander":
      return 3500;
    case "dance":
    case "play-toy":
      return 4000;
    case "window":
    case "sit":
      return 5000;
    default:
      return 3000;
  }
}
