"use client";

import { useEffect, useMemo, useState } from "react";
import { guess, hidingPlaces, ROUNDS, START, TRIES } from "@/lib/pet/games/hide-seek";
import { fill, HIDE_SEEK_FOUND, HIDE_SEEK_MISS, pickLine } from "@/lib/pet/voice";
import type { Species, Stage } from "@/lib/pet/state";
import { PetSprite } from "../pet-sprite";

const SPOT_LOOKS: Record<string, { emoji: string; name: string }> = {
  bed: { emoji: "🛏️", name: "the bed" },
  toybox: { emoji: "🧰", name: "the toy box" },
  rug: { emoji: "🟫", name: "the rug" },
  plant: { emoji: "🪴", name: "the plant" },
  cushion: { emoji: "🛋️", name: "the cushion" },
  beanbag: { emoji: "🫘", name: "the beanbag" },
  lamp: { emoji: "💡", name: "the lamp" },
  fishbowl: { emoji: "🐟", name: "the fishbowl" },
};

/** Phase 47.3: the pet hides behind something in its room; three tries a round to find it. */
export function HideSeekGame({
  seed,
  spots,
  pet,
  name,
  onDone,
}: {
  seed: string;
  spots: readonly string[];
  pet: { species: Species; stage: Stage; form: number };
  name: string;
  onDone: (score: number) => void;
}) {
  const places = useMemo(() => hidingPlaces(seed, spots), [seed, spots]);
  const [state, setState] = useState(START);
  const [shown, setShown] = useState<{ spot: string; found: boolean; line: string } | null>(null);
  const say = (pool: readonly string[]) => fill(pickLine(pool, Math.random), { name, species: pet.species });
  const [hint, setHint] = useState(false);

  // After a few seconds of looking, its tail peeks out.
  useEffect(() => {
    if (state.done || shown) return;
    const timer = window.setTimeout(() => setHint(true), 4000);
    return () => window.clearTimeout(timer);
  }, [state.round, state.done, shown]);

  function look(spot: string) {
    if (shown || state.done) return;
    const result = guess(state, places, spot);
    const roundOver = result.state.round !== state.round;
    if (!roundOver) {
      setState(result.state);
      setShown({ spot, found: false, line: say(HIDE_SEEK_MISS) });
      window.setTimeout(() => setShown(null), 700);
      return;
    }
    const there = SPOT_LOOKS[places[state.round]]?.name ?? "there";
    setShown({ spot: places[state.round], found: result.found, line: result.found ? say(HIDE_SEEK_FOUND) : `${name} was behind ${there}!` });
    window.setTimeout(() => {
      setShown(null);
      setHint(false);
      setState(result.state);
      if (result.state.done) onDone(result.state.found);
    }, 1400);
  }

  const here = places[state.round];
  return (
    <div className="space-y-3">
      <p className="text-center font-bold" aria-live="polite">
        {state.done
          ? `You found ${name} ${state.found} of ${ROUNDS} times.`
          : shown
            ? shown.line
            : `Round ${state.round + 1} of ${ROUNDS}. Where's ${name}? (${TRIES - state.tries} ${TRIES - state.tries === 1 ? "try" : "tries"} left)`}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {spots.map((spot) => {
          const looks = SPOT_LOOKS[spot] ?? { emoji: "📦", name: spot };
          const reveal = shown?.spot === spot && spot === here;
          return (
            <button
              key={spot}
              type="button"
              onClick={() => look(spot)}
              disabled={state.done}
              aria-label={`Look behind ${looks.name}`}
              className="relative flex aspect-square items-center justify-center rounded-2xl border-2 border-ink bg-card text-5xl shadow-[0_3px_0_#1f2933] transition active:translate-y-0.5 dark:border-white/20"
            >
              {reveal ? <PetSprite {...pet} mood="excited" pose="hop" className="w-4/5" /> : <span aria-hidden="true">{looks.emoji}</span>}
              {hint && !shown && spot === here && (
                <span aria-hidden="true" className="absolute bottom-2 right-3 h-3 w-6 animate-[pet-wiggle_0.5s_ease-in-out_infinite] rounded-full bg-grape" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
