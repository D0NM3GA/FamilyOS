"use client";

import { useActionState } from "react";
import { hearts } from "@/lib/pet/state";
import { PET_NAME_MAX } from "@/lib/pet/words";
import { btn, card, field, fieldLabel } from "@/components/styles";
import { SubmitButton } from "@/components/submit";
import { renamePet, type HatchState } from "./actions";
import type { ScreenPet } from "./pet-screen";

/** Phase 47: how the pet is doing, as hearts and words, and renaming it. */

function Meter({ label, value, icon }: { label: string; value: number; icon: string }) {
  const filled = hearts(value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-sm font-bold">{label}</span>
      <span aria-hidden="true" className="text-lg tracking-tight">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className={i < filled ? "" : "opacity-20 grayscale"}>
            {icon}
          </span>
        ))}
      </span>
      <span className="sr-only">
        {filled} of 4
      </span>
    </div>
  );
}

export function StatsPanel({ pet }: { pet: ScreenPet }) {
  const [state, rename] = useActionState<HatchState, FormData>(renamePet, {});
  return (
    <div className={`${card} mx-auto grid max-w-3xl gap-4 sm:grid-cols-2`}>
      <div className="space-y-2">
        <p className="text-lg font-extrabold">
          {pet.name} <span className="font-bold text-muted-foreground">the {pet.formName}</span>
        </p>
        <Meter label="Tummy" value={pet.hunger} icon="🍙" />
        <Meter label="Fun" value={pet.fun} icon="💗" />
        <Meter label="Energy" value={pet.energy} icon="⚡" />
        <p className="text-sm">
          <span className="font-bold">Manners:</span> {Math.round(pet.discipline)}%
        </p>
        <p className="text-sm">
          <span className="font-bold">Age:</span> {pet.ageDays} {pet.ageDays === 1 ? "day" : "days"} · <span className="font-bold">Weight:</span> {Math.round(pet.weight)} g
        </p>
      </div>
      <form action={rename} className="grid content-start gap-2">
        <label className="grid gap-1">
          <span className={fieldLabel}>Rename</span>
          <input name="name" defaultValue={pet.name} maxLength={PET_NAME_MAX} className={field} autoComplete="off" />
        </label>
        {state.error && <p className="text-sm font-bold text-destructive">{state.error}</p>}
        <SubmitButton className={btn}>Save name</SubmitButton>
      </form>
    </div>
  );
}
