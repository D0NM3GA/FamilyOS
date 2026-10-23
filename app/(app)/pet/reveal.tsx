"use client";

import { useEffect, useRef } from "react";
import type { Species, Stage } from "@/lib/pet/state";
import { trickName, type TrickId } from "@/lib/pet/tricks";
import { fill, GROW_REVEAL_LINES, HATCH_REVEAL_LINES, pickLine, TRICK_LEARNED_LINES } from "@/lib/pet/voice";
import { formName } from "@/lib/pet/words";
import { rngFor } from "@/lib/pet/random";
import { PetSprite } from "./pet-sprite";

export type ScreenReveal = { from: { stage: Stage; form: number } | null; to: { stage: Stage; form: number } } | null;

/**
 * Phase 54: the moment it grows up (or hatches, or learns a trick). The old form glows and
 * fades, the new one pops in with sparkles, and a line names it. The page shows this until the
 * kid taps "Yay!" (focused, so Enter or Space works; Escape too), which saves it as seen.
 * Reduced motion finishes the animations at once: a still before-and-after.
 */
export function RevealMoment({
  name,
  species,
  reveal,
  newTricks,
  onDone,
}: {
  name: string;
  species: Species;
  reveal: ScreenReveal;
  newTricks: TrickId[];
  onDone: () => void;
}) {
  const yay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    yay.current?.focus();
  }, []);

  const context = { name, species };
  const lines: string[] = [];
  if (reveal) {
    const form = formName(species, reveal.to.stage, reveal.to.form);
    const pool = reveal.from === null ? HATCH_REVEAL_LINES : GROW_REVEAL_LINES;
    lines.push(fill(pickLine(pool, rngFor(name, reveal.to.stage, reveal.to.form)), { ...context, form }));
  }
  for (const trick of newTricks) {
    lines.push(fill(pickLine(TRICK_LEARNED_LINES, rngFor(name, trick)), { ...context, trick: trickName(trick).toLowerCase() }));
  }
  const to = reveal?.to;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pet-reveal-line"
      onKeyDown={(event) => event.key === "Escape" && onDone()}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-card/85 p-4 text-center backdrop-blur-sm"
    >
      {to && (
        <div className="relative h-[45%] w-[32%]">
          {reveal.from && (
            <PetSprite species={species} stage={reveal.from.stage} form={reveal.from.form} mood="happy" pose="idle" className="pet-reveal-out absolute inset-0 size-full" />
          )}
          <PetSprite species={species} stage={to.stage} form={to.form} mood="excited" pose="hop" className="pet-reveal-in absolute inset-0 size-full" />
          <span aria-hidden="true" className="pet-reveal-sparkles absolute inset-0 text-2xl">
            ✨
          </span>
        </div>
      )}
      <div id="pet-reveal-line" className="space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-lg font-extrabold sm:text-xl">
            {line}
          </p>
        ))}
      </div>
      <button
        ref={yay}
        type="button"
        onClick={onDone}
        className="min-h-12 rounded-2xl border-2 border-ink bg-sun px-8 text-lg font-extrabold text-ink shadow-[0_3px_0_#1f2933] active:translate-y-0.5"
      >
        Yay!
      </button>
    </div>
  );
}
