"use client";

import { useMemo, useRef, useState } from "react";
import { bathScore, BUBBLE_BATH_MS, bubbleSchedule, isShowing, pop } from "@/lib/pet/games/bubble-bath";
import type { Species, Stage } from "@/lib/pet/state";
import { PetSprite } from "../pet-sprite";
import { useGameClock } from "./use-game-clock";

/** Phase 47.3: tap (or tab to and press) each bubble to pop it before it drifts away. */
export function BubbleBathGame({
  seed,
  pet,
  onDone,
}: {
  seed: string;
  pet: { species: Species; stage: Stage; form: number };
  onDone: (score: number) => void;
}) {
  const bubbles = useMemo(() => bubbleSchedule(seed), [seed]);
  const [popped, setPopped] = useState<ReadonlySet<number>>(new Set());
  const [finished, setFinished] = useState(false);
  const latest = useRef<ReadonlySet<number>>(new Set());
  const ended = useRef(false);
  const t = useGameClock(!finished, (time) => {
    if (ended.current || time < BUBBLE_BATH_MS) return;
    ended.current = true;
    setFinished(true);
    onDone(bathScore(bubbles, latest.current));
  });

  function popOne(id: number) {
    latest.current = pop(bubbles, latest.current, id, t);
    setPopped(latest.current);
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-sky/20 to-sky/40">
      <p className="absolute left-3 top-2 z-10 text-lg font-extrabold" aria-live="polite">
        🫧 {bathScore(bubbles, popped)}
      </p>
      <p className="absolute right-3 top-2 z-10 text-sm font-bold text-muted-foreground">{Math.max(0, Math.ceil((BUBBLE_BATH_MS - t) / 1000))}s</p>
      <div className="absolute inset-x-[25%] bottom-[6%]">
        <PetSprite {...pet} mood={popped.size > 0 ? "happy" : "content"} pose="idle" className="w-full" />
      </div>
      {bubbles
        .filter((bubble) => isShowing(bubble, t, popped))
        .map((bubble) => (
          <button
            key={bubble.id}
            type="button"
            onClick={() => popOne(bubble.id)}
            aria-label={bubble.duck ? "Rubber duck" : "Bubble"}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-white/30 text-2xl shadow-inner transition-transform hover:scale-110"
            style={{ left: `${bubble.x * 100}%`, top: `${bubble.y * 100}%`, width: `${bubble.size * 100}%`, aspectRatio: "1" }}
          >
            {bubble.duck ? "🦆" : ""}
          </button>
        ))}
    </div>
  );
}
