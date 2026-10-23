"use client";

import { useActionState, useState } from "react";
import type { DeathCause, Species, Stage } from "@/lib/pet/state";
import { formName, memoryLine, PET_NAME_MAX, SPECIES_NAMES } from "@/lib/pet/words";
import { fill, GOODBYE_AFTER, HATCH_INTRO, HATCH_PENDING } from "@/lib/pet/voice";
import { btnPrimary, card, field, fieldLabel } from "@/components/styles";
import { SubmitButton } from "@/components/submit";
import { hatchPet, type HatchState } from "./actions";
import type { Goodbye } from "@/lib/pet/queries";
import { PetSprite } from "./pet-sprite";

const SPECIES_ORDER: readonly Species[] = ["blob", "bird", "critter"];

/**
 * Phase 47: picking an egg and naming it. After a pet has gone, its goodbye comes first,
 * gently, and a new egg is ready straight away (the owner's call).
 */
export function HatchPanel({ goodbye }: { goodbye: Goodbye | null }) {
  const [state, hatch] = useActionState<HatchState, FormData>(hatchPet, {});
  const [species, setSpecies] = useState<Species>("blob");

  return (
    <div className="space-y-6">
      {goodbye && (
        <section className={`${card} flex items-center gap-4`}>
          <PetSprite
            species={goodbye.species as Species}
            stage={goodbye.stage as Stage}
            form={goodbye.form}
            mood="asleep"
            pose="idle"
            className="w-24 shrink-0"
          />
          <div>
            <h2 className="text-xl font-extrabold">Goodbye, {goodbye.name} 🌈</h2>
            <p className="mt-1">
              {memoryLine(goodbye.name, goodbye.ageMinutes, formName(goodbye.species as Species, goodbye.stage as Stage, goodbye.form), goodbye.cause as DeathCause)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{fill(GOODBYE_AFTER, { name: goodbye.name, species: goodbye.species as Species })}</p>
          </div>
        </section>
      )}

      <form action={hatch} className={`${card} space-y-4`}>
        <fieldset>
          <legend className="text-xl font-extrabold">{goodbye ? "Pick a new egg" : "Pick an egg"}</legend>
          <p className="text-sm text-muted-foreground">{HATCH_INTRO} What it grows into is up to you.</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {SPECIES_ORDER.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-ink/20 p-3 font-bold has-[:checked]:border-ink has-[:checked]:bg-sun has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring dark:border-white/20"
              >
                <input type="radio" name="species" value={option} checked={species === option} onChange={() => setSpecies(option)} className="sr-only" />
                <PetSprite species={option} stage="egg" form={0} mood="content" pose={species === option ? "wobble" : "idle"} className="w-20" />
                {SPECIES_NAMES[option]} egg
              </label>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-1">
          <span className={fieldLabel}>Name it</span>
          <input name="name" required maxLength={PET_NAME_MAX} className={field} autoComplete="off" placeholder="Pip" />
        </label>
        {state.error && <p className="text-sm font-bold text-destructive">{state.error}</p>}
        <SubmitButton className={btnPrimary} pendingText={HATCH_PENDING}>
          This one!
        </SubmitButton>
      </form>
    </div>
  );
}
