"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { verifyPinAndSelect, type PinState } from "./actions";

const initialState: PinState = {};
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const MAX_PIN_LENGTH = 8;

/**
 * A native <dialog> opened with showModal(): the browser keeps focus inside it, Escape closes
 * it and screen readers hear it as a modal. The big number pad is for small fingers on the
 * family tablet; typing still works.
 */
export function PinDialog({ personId, label, onClose }: { personId: string; label: string; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(verifyPinAndSelect, initialState);
  const [pin, setPin] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => dialog?.close();
  }, []);

  // A wrong guess clears the boxes for the next try.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.error) setPin("");
  }

  const press = (key: string) => {
    setPin((p) => (p + key).slice(0, MAX_PIN_LENGTH));
    inputRef.current?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pin-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the <dialog> itself, not the form inside it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-full max-w-xs rounded-3xl border-2 border-ink bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50 animate-in zoom-in-95 duration-200 dark:border-white/20"
    >
      <form action={formAction} className="space-y-4 p-6">
        <input type="hidden" name="personId" value={personId} />
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Enter the PIN for</p>
          <h2 id="pin-title" className="text-2xl font-extrabold">
            {label}
          </h2>
        </div>
        <label className="sr-only" htmlFor="pin-input">
          PIN
        </label>
        <input
          id="pin-input"
          ref={inputRef}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={MAX_PIN_LENGTH}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))}
          aria-describedby={state.error ? "pin-error" : undefined}
          className="w-full rounded-xl border-2 border-input bg-background px-3 py-2 text-center text-2xl tracking-[0.5em] focus:border-ring focus:outline-none"
        />
        {state.error && (
          <p id="pin-error" role="alert" className="text-center text-sm font-bold text-destructive">
            {state.error}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <PadKey key={k} onClick={() => press(k)}>
              {k}
            </PadKey>
          ))}
          <PadKey onClick={() => setPin((p) => p.slice(0, -1))} label="Delete the last digit">
            <Delete size={22} />
          </PadKey>
          <PadKey onClick={() => press("0")}>0</PadKey>
          <button
            type="submit"
            disabled={pending || pin.length === 0}
            className="min-h-14 rounded-2xl border-2 border-ink bg-lime text-lg font-extrabold text-ink transition active:translate-y-0.5 disabled:opacity-50"
          >
            {pending ? "…" : "Go"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-bold text-muted-foreground ring-1 ring-input hover:bg-muted"
        >
          Cancel
        </button>
      </form>
    </dialog>
  );
}

function PadKey({ onClick, label, children }: { onClick: () => void; label?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex min-h-14 items-center justify-center rounded-2xl bg-muted text-2xl font-extrabold transition hover:bg-sun hover:text-ink active:translate-y-0.5"
    >
      {children}
    </button>
  );
}
