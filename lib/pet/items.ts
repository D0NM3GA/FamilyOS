import { STAGES, type Stage } from "./state";
import type { Toy } from "./personality";

/**
 * Phase 47: everything a pet can own. Items belong to the person, not the pet, so a new pet
 * moves into the room the last one left. Nothing here is bought: items come with growing up
 * and with bond (and, later, as presents). Pure and client-safe.
 */

/**
 * Phase 56: the surfaces a decoration stands or hangs on. Each holds as many things as fit,
 * each at its own spot along it (`x`, lib/pet/room.ts). Before then the room had five fixed
 * slots, one thing each; the two floor ones are read as the floor (`readPlace`).
 */
export const SURFACES = ["wall", "shelf", "sill", "floor"] as const;
export type Surface = (typeof SURFACES)[number];

/** Where an item can be: a decoration's surface, a toy left out, a hat worn; null is the toy box. */
export type Place = Surface | "out" | "worn" | null;

/** The old floor slots, and where on the floor each stood. */
const OLD_FLOOR_SLOTS: Partial<Record<string, { x: number; y: number }>> = { "floor-left": { x: 62, y: 228 }, "floor-right": { x: 258, y: 205 } };

export type Spot = { x: number | null; y: number | null };

/** A saved place and spot as they are today, from any version: unknown places go back in the box. */
export function readPlace(place: string | null, spot: Spot): { place: Place } & Spot {
  const old = place ? OLD_FLOOR_SLOTS[place] : undefined;
  if (old) return { place: "floor", x: spot.x ?? old.x, y: spot.y ?? old.y };
  if (place === null || place === "out" || place === "worn" || (SURFACES as readonly string[]).includes(place)) return { place: place as Place, ...spot };
  return { place: null, x: null, y: null };
}

export function isSurface(place: Place | string): place is Surface {
  return (SURFACES as readonly (string | null)[]).includes(place);
}

export type ItemKind = "toy" | "decor" | "hat";

export type ItemDef = {
  id: string;
  kind: ItemKind;
  name: string;
  /** Only ever arrives as a present (Phase 47.4). */
  giftOnly?: boolean;
  /** The surfaces a decoration fits. */
  surfaces?: readonly Surface[];
};


export const ITEMS: readonly ItemDef[] = [
  { id: "ball", kind: "toy", name: "Ball" },
  { id: "plush", kind: "toy", name: "Plush friend" },
  { id: "bubbles", kind: "toy", name: "Bubble wand" },
  { id: "drum", kind: "toy", name: "Little drum" },
  { id: "kite", kind: "toy", name: "Kite" },
  { id: "plant", kind: "decor", name: "Potted plant", surfaces: ["floor", "shelf", "sill"] },
  { id: "cushion", kind: "decor", name: "Cushion", surfaces: ["floor"] },
  { id: "poster", kind: "decor", name: "Star poster", surfaces: ["wall"] },
  { id: "lamp", kind: "decor", name: "Night lamp", surfaces: ["floor", "shelf"] },
  { id: "fishbowl", kind: "decor", name: "Fishbowl", surfaces: ["shelf", "sill"] },
  { id: "clock", kind: "decor", name: "Cuckoo clock", surfaces: ["wall"] },
  { id: "beanbag", kind: "decor", name: "Beanbag", surfaces: ["floor"] },
  { id: "flowers", kind: "decor", name: "Flower box", surfaces: ["sill"] },
  { id: "fairy-lights", kind: "decor", name: "Fairy lights", surfaces: ["wall"], giftOnly: true },
  { id: "rocket", kind: "decor", name: "Toy rocket", surfaces: ["floor", "shelf"], giftOnly: true },
  { id: "rainbow", kind: "decor", name: "Rainbow print", surfaces: ["wall"], giftOnly: true },
  { id: "party-hat", kind: "hat", name: "Party hat" },
  { id: "bow", kind: "hat", name: "Bow" },
  { id: "crown", kind: "hat", name: "Tiny crown" },
  { id: "sunglasses", kind: "hat", name: "Cool shades", giftOnly: true },
  { id: "flower-crown", kind: "hat", name: "Flower crown", giftOnly: true },
];

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS.find((item) => item.id === id);
}

export function isToy(id: string): id is Toy {
  return itemDef(id)?.kind === "toy";
}

export function fitsPlace(id: string, place: Place): boolean {
  const def = itemDef(id);
  if (!def) return false;
  if (place === null) return true;
  if (place === "out") return def.kind === "toy";
  if (place === "worn") return def.kind === "hat";
  return def.kind === "decor" && (def.surfaces ?? []).includes(place);
}

/** What growing up brings, so every pet gets toys and something to decorate with. */
const STAGE_UNLOCKS: Partial<Record<Stage, readonly string[]>> = {
  baby: ["ball", "plant"],
  child: ["plush", "cushion"],
  teen: ["bubbles", "poster", "bow"],
  adult: ["drum", "lamp", "crown"],
};

/** What bond brings, in order: one every so often, for care and play of any kind. */
const BOND_UNLOCKS: readonly (readonly [number, string])[] = [
  [15, "party-hat"],
  [30, "fishbowl"],
  [50, "flowers"],
  [75, "clock"],
  [100, "beanbag"],
  [140, "kite"],
];

/** Every item a pet at this stage and bond has earned, whoever owns them already. */
export function unlockedItems(stage: Stage, bond: number): string[] {
  const reached = STAGES.slice(0, STAGES.indexOf(stage) + 1);
  return [
    ...reached.flatMap((s) => STAGE_UNLOCKS[s] ?? []),
    ...BOND_UNLOCKS.filter(([at]) => bond >= at).map(([, id]) => id),
  ];
}
