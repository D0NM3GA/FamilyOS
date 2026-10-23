import type { Rng } from "./random";

/**
 * Phase 54: tricks. Bond teaches them (the closer the pet and its kid, the more it knows), and
 * the kid asks for one from the Play panel. Doing a trick is a show, not care: it changes
 * nothing on the server, so there's nothing to farm. Bond stays on the server; the page passes
 * the unlocked list. Pure and client-safe.
 */

export const TRICKS = [
  { id: "sit", name: "Sit", bond: 10 },
  { id: "spin", name: "Spin", bond: 25 },
  { id: "wave", name: "Wave", bond: 45 },
  { id: "bow", name: "Bow", bond: 70 },
  { id: "roll", name: "Roll over", bond: 100 },
] as const;

export type TrickId = (typeof TRICKS)[number]["id"];

export function trickName(id: TrickId): string {
  return TRICKS.find((trick) => trick.id === id)?.name ?? id;
}

export function unlockedTricks(bond: number): TrickId[] {
  return TRICKS.filter((trick) => bond >= trick.bond).map((trick) => trick.id);
}

/**
 * Whether it does the trick or something sillier: always with full manners, half the time
 * with none. A silly miss is part of the fun, never a telling-off.
 */
export function tryTrick(discipline: number, rng: Rng): boolean {
  return rng() < 0.5 + Math.max(0, Math.min(100, discipline)) / 200;
}
