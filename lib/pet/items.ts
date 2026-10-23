import { STAGES, type Stage } from "./state";
import type { Toy } from "./personality";

/**
 * Phase 47: everything a pet can own. Items belong to the person, not the pet, so a new pet
 * moves into the room the last one left. Nothing here is bought: items come with growing up
 * and with bond (and, later, as presents). Pure and client-safe.
 */

export const ROOM_SLOTS = ["wall", "shelf", "sill", "floor-left", "floor-right"] as const;
export type RoomSlot = (typeof ROOM_SLOTS)[number];

/** Where an item can be: a decoration's slot, a toy left out, a hat worn; null is the toy box. */
export type Place = RoomSlot | "out" | "worn" | null;

export type ItemKind = "toy" | "decor" | "hat";

export type ItemDef = {
  id: string;
  kind: ItemKind;
  name: string;
  /** Only ever arrives as a present (Phase 47.4). */
  giftOnly?: boolean;
  /** The slots a decoration fits. */
  slots?: readonly RoomSlot[];
};

const FLOOR: readonly RoomSlot[] = ["floor-left", "floor-right"];

export const ITEMS: readonly ItemDef[] = [
  { id: "ball", kind: "toy", name: "Ball" },
  { id: "plush", kind: "toy", name: "Plush friend" },
  { id: "bubbles", kind: "toy", name: "Bubble wand" },
  { id: "drum", kind: "toy", name: "Little drum" },
  { id: "kite", kind: "toy", name: "Kite" },
  { id: "plant", kind: "decor", name: "Potted plant", slots: [...FLOOR, "shelf", "sill"] },
  { id: "cushion", kind: "decor", name: "Cushion", slots: FLOOR },
  { id: "poster", kind: "decor", name: "Star poster", slots: ["wall"] },
  { id: "lamp", kind: "decor", name: "Night lamp", slots: [...FLOOR, "shelf"] },
  { id: "fishbowl", kind: "decor", name: "Fishbowl", slots: ["shelf", "sill"] },
  { id: "clock", kind: "decor", name: "Cuckoo clock", slots: ["wall"] },
  { id: "beanbag", kind: "decor", name: "Beanbag", slots: FLOOR },
  { id: "flowers", kind: "decor", name: "Flower box", slots: ["sill"] },
  { id: "fairy-lights", kind: "decor", name: "Fairy lights", slots: ["wall"], giftOnly: true },
  { id: "rocket", kind: "decor", name: "Toy rocket", slots: [...FLOOR, "shelf"], giftOnly: true },
  { id: "rainbow", kind: "decor", name: "Rainbow print", slots: ["wall"], giftOnly: true },
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
  return def.kind === "decor" && (def.slots ?? []).includes(place);
}

/** What growing up brings, so every pet gets toys and something to decorate with. */
const STAGE_UNLOCKS: Partial<Record<Stage, readonly string[]>> = {
  baby: ["ball", "plant"],
  child: ["plush", "cushion"],
  teen: ["bubbles", "poster", "bow"],
  adult: ["drum", "lamp", "crown"],
};

/** What bond brings, in order: one every so often, for care and play of any kind. */
export const BOND_UNLOCKS: readonly (readonly [number, string])[] = [
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
