"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BOWL_Y, dropY, isOver, SNACK_CATCH_MS, snackSchedule, START, step } from "@/lib/pet/games/snack-catch";
import { useGameClock } from "./use-game-clock";

const TREATS = ["🍓", "🍪", "🍌", "🫐", "🍎"];

/** Phase 47.3: slide the bowl (pointer, or the arrow keys) to catch falling treats. */
export function SnackCatchGame({ seed, onDone }: { seed: string; onDone: (score: number) => void }) {
  const drops = useMemo(() => snackSchedule(seed), [seed]);
  const [bowlX, setBowlX] = useState(0.5);
  const bowl = useRef(0.5);
  const [state, setState] = useState(START);
  const latest = useRef(START);
  const [finished, setFinished] = useState(false);
  // The frame after the last can arrive before the clock stops: end the round only once.
  const ended = useRef(false);
  useEffect(() => {
    bowl.current = bowlX;
  }, [bowlX]);

  const t = useGameClock(!finished, (time) => {
    if (ended.current) return;
    latest.current = step(latest.current, drops, bowl.current, time);
    setState(latest.current);
    if (isOver(time)) {
      ended.current = true;
      setFinished(true);
      onDone(latest.current.score);
    }
  });

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setBowlX(Math.min(0.95, Math.max(0.05, (event.clientX - box.left) / box.width)));
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") setBowlX((x) => Math.max(0.05, x - 0.08));
    else if (event.key === "ArrowRight") setBowlX((x) => Math.min(0.95, x + 0.08));
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="application"
      aria-label="Snack Catch. Use the left and right arrow keys to move the bowl."
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={onMove}
      onPointerDown={onMove}
      className="relative aspect-[4/3] w-full touch-none overflow-hidden rounded-2xl bg-gradient-to-b from-sky/30 to-sun/20 outline-none focus-visible:ring-4 focus-visible:ring-ring"
    >
      <p className="absolute left-3 top-2 text-lg font-extrabold" aria-live="polite">
        🍓 {state.score}
      </p>
      <p className="absolute right-3 top-2 text-sm font-bold text-muted-foreground">{Math.max(0, Math.ceil((SNACK_CATCH_MS - t) / 1000))}s</p>
      {drops.map((drop) => {
        const y = dropY(drop, t);
        if (y < -0.1 || y > BOWL_Y + 0.02 || state.resolved.has(drop.id)) return null;
        return (
          <span key={drop.id} aria-hidden="true" className="absolute -translate-x-1/2 -translate-y-1/2 text-3xl" style={{ left: `${drop.x * 100}%`, top: `${y * 100}%` }}>
            {drop.broccoli ? "🥦" : TREATS[drop.id % TREATS.length]}
          </span>
        );
      })}
      <span aria-hidden="true" className="absolute -translate-x-1/2 text-5xl" style={{ left: `${bowlX * 100}%`, top: `${(BOWL_Y - 0.06) * 100}%` }}>
        🥣
      </span>
    </div>
  );
}
