"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { clearMyPin, setMyPin, type MyPinState } from "./actions";

const field =
  "min-h-11 w-40 rounded-md border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.3em] focus:border-ring focus:outline-none sm:min-h-9";
const button = "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-input hover:bg-muted disabled:opacity-50 sm:min-h-9";

/** Settings → "Lock my tile": set, change or remove the PIN on your own picker tile. Plain, like Settings. */
export function MyPin({ hasPin }: { hasPin: boolean }) {
  const [state, formAction, pending] = useActionState<MyPinState, FormData>(setMyPin, {});
  const [open, setOpen] = useState(!hasPin);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-sm text-foreground">🔒 Your tile is locked with a PIN.</span>
        <button type="button" className={button} onClick={() => setOpen(true)}>
          Change it
        </button>
        <button
          type="button"
          className={button}
          disabled={removing}
          onClick={() => {
            if (!window.confirm("Take the PIN off your tile? Anyone at this device could open your profile again.")) return;
            startRemove(async () => {
              const result = await clearMyPin();
              setRemoveError(result.error ?? null);
              // No PIN any more: back to the "set one" form.
              if (!result.error) setOpen(true);
            });
          }}
        >
          Remove it
        </button>
        {removeError && <p role="alert" className="w-full text-sm text-destructive">{removeError}</p>}
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        New PIN (6 digits)
        <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Again
        <input name="again" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required className={field} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60 sm:min-h-9"
      >
        {pending ? "Saving…" : "Save PIN"}
      </button>
      {hasPin && (
        <button type="button" className={button} onClick={() => setOpen(false)}>
          Cancel
        </button>
      )}
      {state.error && <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>}
      {state.saved && <p role="status" className="w-full text-sm text-foreground">Saved. Your tile asks for it from now on.</p>}
    </form>
  );
}
