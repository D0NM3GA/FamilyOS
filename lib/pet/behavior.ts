import type { Personality, Toy } from "./personality";
import { pickWeighted, type Rng } from "./random";
import type { Stage } from "./state";

/**
 * Phase 47: what the pet does next when nobody is playing with it. A weighted pick from its
 * state, its personality and what's in its room, so "it went and napped on the cushion" comes
 * from being tired, not a coin flip in the view. The screen asks for a new one each time the
 * last finishes. Pure and client-safe.
 */

export type Weather = "clear" | "cloudy" | "rain" | "snow";

export type RoomView = {
  /** Toys left out on the floor, which it may play with on its own. */
  toysOut: readonly Toy[];
  /** Decoration item ids placed in the room. */
  decor: readonly string[];
  weather: Weather;
};

export type BehaviorKind =
  | "wobble"
  | "sleep"
  | "lie-down"
  | "call"
  | "wander"
  | "sit"
  | "look"
  | "window"
  | "dance"
  | "sulk"
  | "yawn"
  | "hop"
  | "peek"
  | "play-toy"
  | "sniff";

export type Behavior = { kind: BehaviorKind; target?: string };

/** What the chooser needs to know about the pet right now. */
export type BehaviorInput = { stage: Stage; sick: boolean; fun: number; energy: number; napping: boolean; calling: boolean };

/** Decorations it would rather nap on than the bed. */
const NAP_SPOTS = ["cushion", "beanbag"];

export function nextBehavior(state: BehaviorInput, personality: Personality, room: RoomView, awake: boolean, rng: Rng): Behavior {
  if (state.stage === "egg") return { kind: "wobble" };
  if (!awake || state.napping) {
    return { kind: "sleep", target: room.decor.find((item) => NAP_SPOTS.includes(item)) ?? "bed" };
  }
  if (state.sick) return { kind: "lie-down" };
  if (state.calling) return { kind: "call" };

  const { quirk, favoriteToy } = personality;
  const hasFavorite = room.toysOut.includes(favoriteToy);
  const kind = pickWeighted<BehaviorKind>(rng, [
    ["wander", 3],
    ["sit", 2],
    ["look", 2],
    ["window", room.weather === "rain" || room.weather === "snow" ? 3 : 1],
    ["dance", state.fun > 70 ? 2 + (quirk === "show-off" ? 2 : 0) : 0],
    ["sulk", state.fun < 30 ? 3 : 0],
    ["yawn", state.energy < 40 || quirk === "sleepy" ? 2 : 0],
    ["hop", quirk === "bouncy" ? 3 : 1],
    ["peek", quirk === "shy" && room.decor.length > 0 ? 2 : 0],
    ["play-toy", room.toysOut.length > 0 ? 2 + (hasFavorite ? 3 : 0) : 0],
    ["sniff", room.decor.length > 0 ? 1 : 0],
  ]);

  switch (kind) {
    case "play-toy":
      return { kind, target: hasFavorite && rng() < 0.6 ? favoriteToy : room.toysOut[Math.floor(rng() * room.toysOut.length)] };
    case "peek":
    case "sniff":
      return { kind, target: room.decor[Math.floor(rng() * room.decor.length)] };
    default:
      return { kind };
  }
}
