"use client";

import type { PointerEvent } from "react";
import { isSurface, itemDef, ITEMS, type Place, type Surface } from "@/lib/pet/items";
import { btn, card, field, sectionTitle } from "@/components/styles";
import { ToyIcon } from "./pet-controls";
import { DecorationPicture } from "./pet-room";
import type { ScreenItem } from "./pet-screen";
import type { Dragged } from "./use-room-drag";

/**
 * Phase 47: decorating the room, leaving toys out and dressing the pet up. Phase 56: things
 * are dragged from here into the room and slid along its surfaces there (pet-screen.tsx);
 * each decoration also has a "Where" list, for a tap or a keyboard instead of a drag.
 */

export const SURFACE_NAMES: Record<Surface, string> = {
  wall: "On the wall",
  shelf: "On the shelf",
  sill: "On the windowsill",
  floor: "On the floor",
};

export function RoomPanel({
  items,
  onMove,
  onDragStart,
}: {
  items: ScreenItem[];
  onMove: (itemRowId: string, place: Place | "box") => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: Dragged) => void;
}) {
  const decorItems = items.filter((item) => itemDef(item.itemId)?.kind === "decor");
  const toys = items.filter((item) => itemDef(item.itemId)?.kind === "toy");
  const hats = items.filter((item) => itemDef(item.itemId)?.kind === "hat");
  const grab = (item: ScreenItem) => (event: PointerEvent<HTMLElement>) => onDragStart(event, { rowId: item.id, itemId: item.itemId });

  return (
    <div className={`${card} mx-auto max-w-3xl select-none space-y-4`}>
      <p className="text-sm text-muted-foreground">
        Drag things up into the room, and slide them along the wall, shelf, windowsill or floor. Drag one out of the room to put it back in the toy box.
      </p>
      {decorItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">New things for the room turn up as your pet grows.</p>
      ) : (
        <div>
          <p className={sectionTitle}>Decorations</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {decorItems.map((item) => {
              const def = itemDef(item.itemId);
              const placed = item.place !== null && isSurface(item.place);
              return (
                <li key={item.id} className={`grid gap-1 rounded-2xl border-2 p-2 ${placed ? "border-ink/40 bg-sun/20 dark:border-white/30" : "border-dashed border-input"}`}>
                  <div
                    onPointerDown={grab(item)}
                    className="flex h-16 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                    aria-hidden="true"
                    title={`Drag the ${def?.name.toLowerCase()} into the room`}
                  >
                    <DecorationPicture id={item.itemId} className="h-full" />
                  </div>
                  <label className="grid gap-1 text-sm font-bold">
                    {def?.name}
                    <select
                      className={`${field} py-1 text-sm`}
                      value={placed ? (item.place as string) : "box"}
                      onChange={(event) => onMove(item.id, event.target.value as Surface | "box")}
                    >
                      <option value="box">In the toy box</option>
                      {(def?.surfaces ?? []).map((surface) => (
                        <option key={surface} value={surface}>
                          {SURFACE_NAMES[surface]}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {toys.length > 0 && (
        <div>
          <p className={sectionTitle}>Toys on the floor</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {toys.map((toy) => (
              <button
                key={toy.id}
                type="button"
                className={`${btn} touch-none`}
                aria-pressed={toy.place === "out"}
                onPointerDown={toy.place === "out" ? undefined : grab(toy)}
                onClick={() => onMove(toy.id, toy.place === "out" ? "box" : "out")}
              >
                <ToyIcon id={toy.itemId} /> {itemDef(toy.itemId)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {hats.length > 0 && (
        <div>
          <p className={sectionTitle}>Dress up</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hats.map((hat) => (
              <button
                key={hat.id}
                type="button"
                className={`${btn} touch-none`}
                aria-pressed={hat.place === "worn"}
                onPointerDown={hat.place === "worn" ? undefined : grab(hat)}
                onClick={() => onMove(hat.id, hat.place === "worn" ? "box" : "worn")}
              >
                {itemDef(hat.itemId)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {items.length} of {ITEMS.length} things found so far.
      </p>
    </div>
  );
}
