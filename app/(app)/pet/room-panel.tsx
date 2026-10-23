"use client";

import { useTransition } from "react";
import { fitsPlace, itemDef, ITEMS, ROOM_SLOTS, type RoomSlot } from "@/lib/pet/items";
import { btn, card, field, fieldLabel, sectionTitle } from "@/components/styles";
import { placeItem } from "./actions";
import { ToyIcon } from "./pet-controls";
import type { ScreenItem } from "./pet-screen";

/** Phase 47: decorating the room, leaving toys out and dressing the pet up. */

const SLOT_NAMES: Record<RoomSlot, string> = {
  wall: "On the wall",
  shelf: "On the shelf",
  sill: "On the windowsill",
  "floor-left": "Floor, by the bowl",
  "floor-right": "Floor, by the bed",
};

export function RoomPanel({ items }: { items: ScreenItem[] }) {
  const [pending, startTransition] = useTransition();
  // The action's revalidatePath sends the fresh page back; no extra refresh needed.
  const move = (itemRowId: string, place: string) =>
    startTransition(async () => {
      await placeItem(itemRowId, place);
    });
  const decorItems = items.filter((item) => itemDef(item.itemId)?.kind === "decor");
  const toys = items.filter((item) => itemDef(item.itemId)?.kind === "toy");
  const hats = items.filter((item) => itemDef(item.itemId)?.kind === "hat");

  return (
    <div className={`${card} mx-auto max-w-3xl space-y-4`} aria-busy={pending || undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROOM_SLOTS.map((slot) => {
          const here = items.find((item) => item.place === slot);
          const fits = decorItems.filter((item) => fitsPlace(item.itemId, slot));
          return (
            <div key={slot} className="grid gap-1">
              <label htmlFor={`pet-slot-${slot}`} className={fieldLabel}>
                {SLOT_NAMES[slot]}
              </label>
              <select
                id={`pet-slot-${slot}`}
                className={field}
                value={here?.id ?? ""}
                disabled={pending || fits.length === 0}
                onChange={(event) => (event.target.value ? move(event.target.value, slot) : here && move(here.id, "box"))}
              >
                <option value="">{fits.length === 0 ? "Nothing fits here yet" : "Empty"}</option>
                {fits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {itemDef(item.itemId)?.name}
                    {item.place && item.place !== slot ? ` (move from ${SLOT_NAMES[item.place as RoomSlot]?.toLowerCase() ?? "elsewhere"})` : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {decorItems.length === 0 && <p className="text-sm text-muted-foreground">New things for the room turn up as your pet grows.</p>}
      {toys.length > 0 && (
        <div>
          <p className={sectionTitle}>Toys on the floor</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {toys.map((toy) => (
              <button key={toy.id} type="button" className={btn} aria-pressed={toy.place === "out"} disabled={pending} onClick={() => move(toy.id, toy.place === "out" ? "box" : "out")}>
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
              <button key={hat.id} type="button" className={btn} aria-pressed={hat.place === "worn"} disabled={pending} onClick={() => move(hat.id, hat.place === "worn" ? "box" : "worn")}>
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
