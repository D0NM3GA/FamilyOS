"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GAME_DEFS, type GameId } from "@/lib/pet/games/catalog";
import { BUILT_IN_SPOTS } from "@/lib/pet/games/hide-seek";
import type { Species, Stage } from "@/lib/pet/state";
import { btn, btnPrimary, card } from "@/components/styles";
import { finishGame } from "../actions";
import { BubbleBathGame } from "./bubble-bath-game";
import { CopyDanceGame } from "./copy-dance-game";
import { FetchGame } from "./fetch-game";
import { HideSeekGame } from "./hide-seek-game";
import { SnackCatchGame } from "./snack-catch-game";

/** Decorations big enough to hide behind in Hide and Seek. */
const HIDING_DECOR = ["plant", "cushion", "beanbag", "lamp", "fishbowl"];

type Phase = "ready" | "playing" | "done";

/**
 * Phase 47.3: one mini-game round: a ready screen, the game, then how it went. The score goes
 * to the server, which caps what it does and pays out once an hour per game; replaying inside
 * the hour is just for fun.
 */
export function GameStage({
  game,
  pet,
  decor,
  onClose,
}: {
  game: GameId;
  pet: { name: string; species: Species; stage: Stage; form: number };
  decor: readonly string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const def = GAME_DEFS[game];
  const [seedBase] = useState(() => Math.random().toString(36).slice(2));
  const seed = `${game}-${seedBase}-${round}`;
  const sprite = { species: pet.species, stage: pet.stage, form: pet.form };

  const done = useCallback(
    (score: number) => {
      setPhase("done");
      startSaving(async () => {
        const reply = await finishGame(game, score);
        setResult(
          reply.outcome === "ok"
            ? `${pet.name} had a great time!`
            : reply.outcome === "played-recently"
              ? `That one was just for fun: ${pet.name} played it not long ago.`
              : reply.outcome === "too-tired"
                ? `${pet.name} is worn out now. A nap would help.`
                : reply.outcome === "asleep"
                  ? `${pet.name} fell asleep!`
                  : "That was fun!",
        );
        router.refresh();
      });
    },
    [game, pet.name, router],
  );

  return (
    <section className={`${card} mx-auto max-w-3xl space-y-4`} aria-labelledby="pet-game-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="pet-game-title" className="text-2xl font-extrabold">
            <span aria-hidden="true">{def.emoji}</span> {def.name}
          </h2>
          <p className="text-sm text-muted-foreground">{def.blurb}</p>
        </div>
        <button type="button" className={btn} onClick={onClose}>
          Back to the room
        </button>
      </div>

      {phase === "ready" && (
        <div className="flex justify-center py-6">
          <button type="button" className={`${btnPrimary} min-h-14 px-8 text-lg`} onClick={() => setPhase("playing")}>
            Ready? Go!
          </button>
        </div>
      )}

      {phase !== "ready" && (
        <div key={round} className={phase === "done" ? "pointer-events-none opacity-60" : ""}>
          {game === "snack-catch" && <SnackCatchGame seed={seed} onDone={done} />}
          {game === "bubble-bath" && <BubbleBathGame seed={seed} pet={sprite} onDone={done} />}
          {game === "hide-seek" && (
            <HideSeekGame seed={seed} spots={[...BUILT_IN_SPOTS, ...decor.filter((id) => HIDING_DECOR.includes(id))]} pet={sprite} onDone={done} />
          )}
          {game === "copy-dance" && <CopyDanceGame seed={seed} pet={sprite} onDone={done} />}
          {game === "fetch" && <FetchGame pet={sprite} onDone={done} />}
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-lg font-bold" aria-live="polite">
            {saving ? "…" : result}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={saving}
              onClick={() => {
                setRound(round + 1);
                setResult(null);
                setPhase("playing");
              }}
            >
              Play again
            </button>
            <button type="button" className={btn} onClick={onClose}>
              Back to the room
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
