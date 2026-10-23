"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { ALL_STORES, splitForShop, tripSavedHref, type ShopRow } from "@/lib/groceries/shop";
import { chip, chipRow } from "@/components/styles";
import { completeTrip } from "../actions";
import { useShopQueue } from "../shop-queue";

const UNDO_MS = 5000;

/** Keeps the screen on while shopping. Best effort: iOS Low Power Mode, a hidden page or an
 * older browser just says no, and the note simply doesn't show. The lock drops whenever the
 * page is hidden, so it's re-asked for on return. */
function useWakeLock(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) return void lock.release();
        setOn(true);
        lock.addEventListener("release", () => setOn(false));
      } catch {
        setOn(false);
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
  return on;
}

function Row({ row, onTap }: { row: ShopRow; onTap: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        aria-pressed={row.done}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-muted"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${
            row.done ? "border-lime bg-lime text-ink" : "border-ink/40 dark:border-white/40"
          }`}
          aria-hidden
        >
          {row.done && <Check size={18} strokeWidth={3} />}
        </span>
        <span className="text-2xl" aria-hidden>
          {row.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-lg font-extrabold leading-tight break-words ${row.done ? "text-muted-foreground line-through" : ""}`}>
            {row.name}
          </span>
          <span className="block font-hand text-base text-muted-foreground">
            {[row.size, row.forName ? `for ${row.forName}` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="shrink-0 rounded-xl border-2 border-ink/15 px-2.5 py-1 text-sm font-bold dark:border-white/15">{row.amount}</span>
      </button>
    </li>
  );
}

/**
 * Phase 23: the list for the store. Big rows, one thumb, a cart in the other hand. Taps work
 * with no signal (see shop-queue.tsx). Checked items drop into "In the cart"; a mis-tap is
 * one tap to undo, never an "Are you sure?". Finishing carries whatever's left over to next
 * time, because completeTrip only records the checked rows.
 */
export function ShopView({ householdId, rows: serverRows, stores }: { householdId: string; rows: ShopRow[]; stores: string[] }) {
  const router = useRouter();
  const { rows, record, pending, problem, flush } = useShopQueue(householdId, serverRows);
  const [store, setStore] = useState(ALL_STORES);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [finishing, startFinish] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);
  const screenOn = useWakeLock();

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const { toGet, inCart } = splitForShop(rows, store);
  const hereCount = toGet.length + inCart.length;
  const allCart = rows.filter((r) => r.done).length;
  const leftOver = rows.length - allCart;

  function tap(row: ShopRow) {
    record(row.id, !row.done);
    clearTimeout(undoTimer.current);
    if (!row.done) {
      setUndo({ id: row.id, name: row.name });
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    } else {
      setUndo(null);
    }
  }

  function finish() {
    setFinishError(null);
    startFinish(async () => {
      try {
        const result = await completeTrip();
        router.replace(tripSavedHref(result.saved ? result.purchaseId : null));
      } catch (err) {
        // A signed-out profile redirects; let that navigation happen without a scary note.
        if (err instanceof TypeError) setFinishError("Couldn't save the trip. Check your signal and try again.");
        else setFinishError("Couldn't save the trip yet. Reload and try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-extrabold">{store ? `At ${store}` : "Shopping"}</h1>
        {pending > 0 && (
          <span role="status" className="rounded-full bg-sun px-3 py-1 text-sm font-bold text-ink">
            {problem === "waiting" ? `No signal · ${pending} to sync` : `${pending} to sync`}
          </span>
        )}
      </div>
      {problem === "stuck" && (
        <p role="alert" className="rounded-xl bg-tomato/15 px-3 py-2 text-sm font-semibold">
          Couldn&apos;t sync yet.{" "}
          <button type="button" onClick={() => location.reload()} className="inline-flex min-h-11 items-center underline sm:min-h-9">
            Reload to try again
          </button>{" "}
          (your check-offs are kept on this phone).
        </p>
      )}
      {screenOn && <p className="text-sm font-bold text-muted-foreground">☀️ Screen stays on while you shop</p>}

      {stores.length > 1 && (
        <nav aria-label="Which store" className={chipRow}>
          {[ALL_STORES, ...stores].map((s) => (
            <button
              key={s || "all"}
              type="button"
              aria-pressed={store === s}
              onClick={() => setStore(s)}
              className={chip}
            >
              {s || "All stores"}
            </button>
          ))}
        </nav>
      )}

      {toGet.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-ink/20 p-6 text-center font-bold text-muted-foreground">
          {hereCount === 0 ? (store ? `Nothing from ${store} on the list.` : "The list is empty.") : "Everything here is in the cart!"}
        </p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-[3px_3px_0_rgb(31_41_51/0.15)] dark:divide-white/10 dark:border-white/20">
          {toGet.map((r) => (
            <Row key={r.id} row={r} onTap={() => tap(r)} />
          ))}
        </ul>
      )}

      {inCart.length > 0 && (
        <details className="rounded-2xl border-2 border-ink/20 bg-card dark:border-white/20">
          <summary className="cursor-pointer px-4 py-3 font-extrabold">✓ In the cart ({inCart.length})</summary>
          <ul className="divide-y-2 divide-dashed divide-ink/10 dark:divide-white/10">
            {inCart.map((r) => (
              <Row key={r.id} row={r} onTap={() => tap(r)} />
            ))}
          </ul>
        </details>
      )}

      {/* data-covers-bottom: tabbing to a row scrolls it clear of this panel (globals.css). */}
      <div data-covers-bottom className="sticky bottom-[calc(var(--bottom-bar-h,0px)+0.5rem)] mt-2 flex flex-col gap-2 rounded-2xl border-2 border-ink bg-card p-3 shadow-lg dark:border-white/20">
        {undo && (
          <div role="status" className="flex items-center justify-between gap-2 rounded-xl bg-ink py-0.5 pr-1 pl-3 text-sm font-bold text-paper">
            <span className="min-w-0 truncate">Checked off {undo.name}</span>
            <button
              type="button"
              onClick={() => {
                record(undo.id, false);
                setUndo(null);
              }}
              className="inline-flex min-h-11 shrink-0 items-center px-3 text-sun underline sm:min-h-9"
            >
              Undo
            </button>
          </div>
        )}
        <p className="text-sm font-semibold text-muted-foreground">
          {allCart} in the cart · {leftOver} {leftOver === 1 ? "stays" : "stay"} on the list for next time
        </p>
        {finishError && <p role="alert" className="text-sm font-semibold text-tomato">{finishError}</p>}
        <button
          type="button"
          onClick={pending > 0 ? () => void flush() : finish}
          disabled={finishing || allCart === 0}
          className="rounded-xl border-2 border-ink bg-lime py-3 text-lg font-extrabold text-ink disabled:opacity-50"
        >
          {pending > 0
            ? problem === "stuck"
              ? "Sync first, then finish"
              : "Waiting for signal to sync…"
            : finishing
              ? "Saving the trip…"
              : "Finish trip"}
        </button>
      </div>
    </div>
  );
}
