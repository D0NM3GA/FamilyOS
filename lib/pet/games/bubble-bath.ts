import { rngFor } from "../random";

/**
 * Phase 47.3, Bubble Bath: bubbles pop up around the pet for a moment each; tap to pop them.
 * Now and then a rubber duck floats by, worth three. Pure.
 */

export const BUBBLE_BATH_MS = 25_000;
export const BUBBLE_LIFE_MS = 2600;
const BUBBLES = 36;

export type Bubble = { id: number; x: number; y: number; size: number; at: number; duck: boolean };

export function bubbleSchedule(seed: string): Bubble[] {
  const rng = rngFor(seed, "bubble-bath");
  const gap = (BUBBLE_BATH_MS - BUBBLE_LIFE_MS) / BUBBLES;
  return Array.from({ length: BUBBLES }, (_, id) => ({
    id,
    x: 0.12 + rng() * 0.76,
    y: 0.12 + rng() * 0.7,
    size: 0.08 + rng() * 0.06,
    at: Math.round(id * gap),
    duck: id === 12 || id === 28,
  }));
}

export function isShowing(bubble: Bubble, t: number, popped: ReadonlySet<number>): boolean {
  return !popped.has(bubble.id) && t >= bubble.at && t < bubble.at + BUBBLE_LIFE_MS;
}

/** The score for a set of popped bubbles: one each, three for a duck. */
export function bathScore(bubbles: readonly Bubble[], popped: ReadonlySet<number>): number {
  return bubbles.filter((bubble) => popped.has(bubble.id)).reduce((sum, bubble) => sum + (bubble.duck ? 3 : 1), 0);
}

/** Pops a bubble if it's on screen; anything else is a miss and changes nothing. */
export function pop(bubbles: readonly Bubble[], popped: ReadonlySet<number>, id: number, t: number): ReadonlySet<number> {
  const bubble = bubbles.find((b) => b.id === id);
  return bubble && isShowing(bubble, t, popped) ? new Set(popped).add(id) : popped;
}
