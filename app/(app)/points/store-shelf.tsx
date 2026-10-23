"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { canAfford, limitLabel, moreNeeded } from "@/lib/store/rules";
import { chip, field } from "@/components/styles";
import { buyReward, setSavingGoal } from "./actions";
import { RewardWord, useRewardWords } from "@/components/family-look";
import { moreToGo } from "@/lib/reward-words";

export type ShelfReward = {
  id: string;
  title: string;
  emoji: string | null;
  pointCost: number;
  limitPerWeek: number | null;
  needsApproval: boolean;
};

type Member = { id: string; firstName: string; points: number };

const HOLD_MS = 1000;

/**
 * Phase 20: the Sticker Store's reward cards and the buy confirm. Unaffordable rewards stay
 * visible, greyed, with "15 more stickers" (motivating, not a padlock).
 *
 * "No accidental buys": the confirm dialog shows cost / you have / left after, and the buy
 * button needs a one-second press-and-hold with a pointer (little thumbs). Keyboard and
 * screen-reader activation (a click with detail 0) completes straight away — those users
 * already made a deliberate choice, and AT can't send a held press.
 */
export function StoreShelf({
  rewards,
  balance,
  viewerId,
  goalId,
  members,
}: {
  rewards: ShelfReward[];
  balance: number;
  viewerId: string;
  goalId: string | null;
  /** Grown-ups only: whose stickers to spend (themselves by default). */
  members?: Member[];
}) {
  const words = useRewardWords();
  const [picked, setPicked] = useState<ShelfReward | null>(null);
  const [, startGoal] = useTransition();

  if (rewards.length === 0) {
    return <p className="mt-4 text-muted-foreground">Nothing on this shelf yet.</p>;
  }

  return (
    <>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rewards.map((r) => {
          const ok = canAfford(balance, r.pointCost);
          const isGoal = goalId === r.id;
          return (
            <li
              key={r.id}
              className={`flex flex-col gap-3 rounded-2xl border-2 border-ink bg-card p-4 shadow-[3px_3px_0_rgb(31_41_51/0.15)] dark:border-white/20 ${
                ok ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted text-2xl" aria-hidden>
                  {r.emoji ?? "🎁"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-lg font-bold leading-tight break-words">{r.title}</p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {limitLabel(r.limitPerWeek)}
                    {r.needsApproval && " · Needs an OK"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border-2 border-ink bg-sun px-2.5 py-0.5 text-sm font-extrabold text-ink">
                  ⭐ {r.pointCost}
                </span>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  aria-pressed={isGoal}
                  onClick={() => startGoal(() => setSavingGoal(isGoal ? null : r.id))}
                  className={chip}
                >
                  {isGoal ? "★ Saving up for this" : "Save up for this"}
                </button>
                {ok || members ? (
                  <button
                    type="button"
                    onClick={() => setPicked(r)}
                    className="inline-flex min-h-11 items-center rounded-xl border-2 border-ink bg-lime px-4 text-sm font-extrabold text-ink shadow-[2px_2px_0_var(--color-ink)] transition hover:-translate-y-0.5 sm:min-h-9"
                  >
                    Buy
                  </button>
                ) : (
                  <span className="text-sm font-bold text-muted-foreground">{moreToGo(moreNeeded(balance, r.pointCost), words)}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {picked && (
        <BuyDialog
          reward={picked}
          viewerId={viewerId}
          balance={balance}
          members={members}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}

function BuyDialog({
  reward,
  viewerId,
  balance,
  members,
  onClose,
}: {
  reward: ShelfReward;
  viewerId: string;
  balance: number;
  members?: Member[];
  onClose: () => void;
}) {
  const words = useRewardWords();
  const ref = useRef<HTMLDialogElement>(null);
  // A grown-up's own wallet is often empty: start on the first wallet that can afford it.
  const [forId, setForId] = useState(
    () => (members && !members.some((m) => m.id === viewerId && m.points >= reward.pointCost)
      ? (members.find((m) => m.points >= reward.pointCost)?.id ?? viewerId)
      : viewerId),
  );
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const [result, setResult] = useState<{ error?: string; waiting?: boolean } | null>(null);
  const [pending, startBuy] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A synchronous guard for a money action: held Enter auto-repeats clicks faster than a
  // re-render can flip `pending`.
  const inFlight = useRef(false);
  // When the last real press started. A click with no recent press came from a keyboard or a
  // screen reader (VoiceOver's double-tap sends detail 1 with no held pointer).
  const lastPress = useRef(0);

  const wallet = members?.find((m) => m.id === forId)?.points ?? balance;
  const left = wallet - reward.pointCost;
  const affordable = canAfford(wallet, reward.pointCost);

  useEffect(() => {
    ref.current?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function buy() {
    if (inFlight.current || pending || !affordable) return;
    inFlight.current = true;
    startBuy(async () => {
      try {
        const res = await buyReward(reward.id, forId === viewerId ? null : forId);
        setResult("error" in res ? { error: res.error } : { waiting: res.status === "WAITING_OK" });
      } finally {
        inFlight.current = false;
      }
    });
  }

  function stopHold() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Escape mid-purchase would hide whether it went through, so wait for the answer.
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      aria-labelledby="buy-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl border-2 border-ink bg-card p-6 text-card-foreground shadow-[6px_6px_0_rgb(31_41_51/0.25)] backdrop:bg-ink/50 dark:border-white/25"
    >
      {result && !result.error ? (
        <div className="space-y-4 text-center" role="status">
          <p className="text-5xl" aria-hidden>
            {reward.emoji ?? "🎁"}
          </p>
          <h2 id="buy-title" className="text-2xl font-extrabold">
            {result.waiting ? "Asked for an OK!" : "Order placed!"}
          </h2>
          <p className="font-hand text-xl text-brand-text">
            {result.waiting
              ? `Your ${words.many} are on hold. A grown-up will say yes or give them back.`
              : "Mom or Dad will make it happen."}
          </p>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="w-full rounded-2xl border-2 border-ink bg-sun py-3 font-extrabold text-ink"
          >
            Yay!
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 id="buy-title" className="flex items-center gap-2 text-2xl font-extrabold">
            <span aria-hidden>{reward.emoji ?? "🎁"}</span>
            {reward.title}?
          </h2>
          {members && (
            <label className="block text-sm font-bold">
              Whose <RewardWord />?
              <select
                value={forId}
                onChange={(e) => setForId(e.target.value)}
                className={`${field} mt-1 block w-full`}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === viewerId ? `Mine (${m.points})` : `${m.firstName} (${m.points})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-muted p-2">
              <dt className="text-xs font-bold text-muted-foreground">Costs</dt>
              <dd className="font-heading text-2xl font-extrabold">⭐ {reward.pointCost}</dd>
            </div>
            <div className="rounded-2xl bg-muted p-2">
              <dt className="text-xs font-bold text-muted-foreground">You have</dt>
              <dd className="font-heading text-2xl font-extrabold">⭐ {wallet}</dd>
            </div>
            <div className="rounded-2xl bg-muted p-2">
              <dt className="text-xs font-bold text-muted-foreground">Left after</dt>
              <dd className={`font-heading text-2xl font-extrabold ${left < 0 ? "text-destructive" : ""}`}>⭐ {left}</dd>
            </div>
          </dl>
          {reward.needsApproval && forId === viewerId && !members && (
            <p className="text-sm text-muted-foreground">This one needs a grown-up&apos;s OK. Your <RewardWord /> wait on hold until then.</p>
          )}
          {result?.error && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
              {result.error}
            </p>
          )}
          {!affordable && !result?.error && (
            <p className="text-sm font-semibold text-muted-foreground">
              {moreToGo(moreNeeded(wallet, reward.pointCost), words)} needed.
            </p>
          )}
          <button
            type="button"
            disabled={!affordable || pending}
            onPointerDown={(e) => {
              if (e.button !== 0 || !affordable) return;
              lastPress.current = Date.now();
              setHint(false);
              setHolding(true);
              timer.current = setTimeout(() => {
                stopHold();
                buy();
              }, HOLD_MS);
            }}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            onBlur={stopHold}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => {
              // Keyboard / assistive tech (no real press just before this click): buy now.
              // A quick mouse or finger tap that wasn't held just shows the hint.
              const pressed = Date.now() - lastPress.current < 1500;
              if (e.detail === 0 || !pressed) buy();
              else if (!holding) setHint(true);
            }}
            className="relative w-full touch-manipulation select-none overflow-hidden rounded-2xl border-2 border-ink bg-lime py-4 font-heading text-xl font-extrabold text-ink shadow-[3px_3px_0_var(--color-ink)] [-webkit-touch-callout:none] disabled:opacity-50"
          >
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 bg-ink/15 motion-reduce:hidden ${
                holding ? "w-full transition-[width] duration-1000 ease-linear" : "w-0"
              }`}
            />
            <span className="relative">{pending ? "Buying…" : holding ? "Keep holding…" : "Hold to buy"}</span>
          </button>
          <p className={`text-center text-sm ${hint ? "font-bold text-brand-text" : "text-muted-foreground"}`}>
            Press and hold for a second, so little thumbs can&apos;t buy by accident.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => ref.current?.close()}
            className="min-h-11 w-full rounded-2xl py-2 font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      )}
    </dialog>
  );
}
