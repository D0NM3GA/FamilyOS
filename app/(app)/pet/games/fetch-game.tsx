"use client";

import { useState } from "react";
import { markerAt, SWEET_HALF_WIDTH, SWEET_SPOT, THROWS, throwDistance } from "@/lib/pet/games/fetch";
import type { Species, Stage } from "@/lib/pet/state";
import { PetSprite } from "../pet-sprite";
import { useGameClock } from "./use-game-clock";
import { useLater } from "./use-later";

/** Phase 47.3: stop the sweeping marker in the sweet spot to throw far; three throws. */
export function FetchGame({
  pet,
  onDone,
}: {
  pet: { species: Species; stage: Stage; form: number };
  onDone: (score: number) => void;
}) {
  const [throwIndex, setThrowIndex] = useState(0);
  const [distances, setDistances] = useState<number[]>([]);
  const [flying, setFlying] = useState<number | null>(null);
  const t = useGameClock(flying === null && distances.length < THROWS);
  const later = useLater();
  const marker = markerAt(t, throwIndex);

  function throwIt() {
    if (flying !== null || distances.length >= THROWS) return;
    const distance = throwDistance(marker);
    const all = [...distances, distance];
    setFlying(distance);
    later(1600, () => {
      setFlying(null);
      setDistances(all);
      setThrowIndex(all.length);
      if (all.length >= THROWS) onDone(all.reduce((sum, d) => sum + d, 0));
    });
  }

  const total = distances.reduce((sum, d) => sum + d, 0);
  return (
    <div className="space-y-3">
      <p className="text-center font-bold" aria-live="polite">
        {flying !== null ? `${flying} m!` : distances.length >= THROWS ? `${total} m in all.` : `Throw ${distances.length + 1} of ${THROWS}`}
      </p>
      <div className="relative h-28 overflow-hidden rounded-2xl bg-gradient-to-b from-sky/30 to-lime/40">
        <div
          className="absolute bottom-1 w-16 transition-[left] duration-[1500ms] ease-out"
          style={{ left: flying !== null ? `${8 + flying * 0.75}%` : "4%" }}
        >
          <PetSprite {...pet} mood="excited" pose={flying !== null ? "hop" : "idle"} className="w-full" />
        </div>
        {flying !== null && <span aria-hidden="true" className="absolute top-3 text-2xl transition-[left] duration-700" style={{ left: `${10 + flying * 0.78}%` }}>🥏</span>}
      </div>
      <div className="relative mx-auto h-8 max-w-md rounded-full border-2 border-ink bg-card dark:border-white/20" aria-hidden="true">
        <div
          className="absolute inset-y-0 rounded-full bg-lime"
          style={{ left: `${(SWEET_SPOT - SWEET_HALF_WIDTH) * 100}%`, width: `${SWEET_HALF_WIDTH * 200}%` }}
        />
        <div className="absolute inset-y-[-6px] w-1.5 -translate-x-1/2 rounded-full bg-tomato" style={{ left: `${marker * 100}%` }} />
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={throwIt}
          data-game-focus
          // Not disabled mid-throw: a disabled button drops keyboard focus. It just waits instead.
          aria-disabled={flying !== null || undefined}
          disabled={distances.length >= THROWS}
          className="min-h-14 rounded-2xl border-2 border-ink bg-sun px-8 text-lg font-extrabold text-ink shadow-[0_3px_0_#1f2933] active:translate-y-0.5 disabled:opacity-40 aria-disabled:opacity-60"
        >
          🥏 Throw!
        </button>
      </div>
    </div>
  );
}
