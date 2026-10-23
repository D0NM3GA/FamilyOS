"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { copyMove, danceMoves, MAX_ROUNDS, MOVES, roundMoves, START, type Move } from "@/lib/pet/games/copy-dance";
import type { Species, Stage } from "@/lib/pet/state";
import { PetSprite } from "../pet-sprite";

const ARROWS: Record<Move, string> = { left: "⬅️", right: "➡️", up: "⬆️", down: "⬇️" };
const SHIFT: Record<Move, string> = { left: "-translate-x-1/4", right: "translate-x-1/4", up: "-translate-y-1/4", down: "translate-y-[10%] scale-y-90" };
const STEP_MS = 650;

/** Phase 47.3: the pet dances a few moves; copy them with the arrows (on screen or keyboard). */
export function CopyDanceGame({
  seed,
  pet,
  onDone,
}: {
  seed: string;
  pet: { species: Species; stage: Stage; form: number };
  onDone: (score: number) => void;
}) {
  const moves = useMemo(() => danceMoves(seed), [seed]);
  const [state, setState] = useState(START);
  // Which move the pet is showing, while it shows the round; null when it's your turn.
  const [showing, setShowing] = useState<number | null>(0);
  const [pose, setPose] = useState<Move | null>(null);
  const [message, setMessage] = useState("Watch closely…");

  useEffect(() => {
    if (showing === null) return;
    const round = roundMoves(moves, state.round);
    const timer = window.setTimeout(() => {
      if (showing < round.length) {
        setPose(round[showing]);
        setShowing(showing + 1);
      } else {
        setPose(null);
        setShowing(null);
        setMessage("Your turn!");
      }
    }, showing === 0 ? 800 : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [showing, moves, state.round]);

  const press = useCallback(
    (move: Move) => {
      if (showing !== null || state.over) return;
      const { state: next, result } = copyMove(state, moves, move);
      setState(next);
      setPose(move);
      window.setTimeout(() => setPose(null), 250);
      if (result === "round") {
        setMessage(`Round ${next.round + 1}: watch…`);
        window.setTimeout(() => setShowing(0), 600);
      } else if (result === "miss" || result === "won") {
        setMessage(result === "won" ? "A perfect dance! 🌟" : `Oops! You copied ${next.round} ${next.round === 1 ? "dance" : "dances"}.`);
        onDone(next.round);
      }
    },
    [showing, state, moves, onDone],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const move = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key as "ArrowLeft"];
      if (!move) return;
      event.preventDefault();
      press(move);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <div className="space-y-3">
      <p className="text-center font-bold" aria-live="polite">
        {message} <span className="text-muted-foreground">({Math.min(state.round + 1, MAX_ROUNDS)}/{MAX_ROUNDS})</span>
      </p>
      <div className="mx-auto flex aspect-[4/3] w-full max-w-sm items-center justify-center rounded-2xl bg-grape/20">
        <div className={`w-1/2 transition-transform duration-200 ${pose ? SHIFT[pose] : ""}`}>
          <PetSprite {...pet} mood={showing !== null ? "excited" : "happy"} pose={pose ? "idle" : "dance"} className="w-full" />
        </div>
      </div>
      <div className="mx-auto grid max-w-xs grid-cols-4 gap-2">
        {MOVES.map((move) => (
          <button
            key={move}
            type="button"
            onClick={() => press(move)}
            disabled={showing !== null || state.over}
            aria-label={move}
            className="flex aspect-square items-center justify-center rounded-2xl border-2 border-ink bg-card text-3xl shadow-[0_3px_0_#1f2933] active:translate-y-0.5 disabled:opacity-40 dark:border-white/20"
          >
            {ARROWS[move]}
          </button>
        ))}
      </div>
    </div>
  );
}
