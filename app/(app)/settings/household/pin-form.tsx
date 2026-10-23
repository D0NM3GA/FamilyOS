"use client";

import { useActionState, useState } from "react";
import type { PinFormState } from "./actions";

type Action = (prevState: PinFormState, formData: FormData) => Promise<PinFormState>;

/**
 * Inline "Set PIN" control for one member row. The page passes only whether a PIN exists,
 * never the hash itself.
 */
export function PinForm({ action, hasPin, kid }: { action: Action; hasPin: boolean; kid: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<PinFormState, FormData>(action, {});

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{hasPin || state.success ? "Set" : "Not set"}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center text-xs font-medium text-brand-text hover:underline sm:min-h-0"
        >
          {hasPin || state.success ? "Change" : "Set PIN"}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        type="password"
        name="pin"
        inputMode="numeric"
        autoComplete="new-password"
        pattern="\d{4,6}"
        maxLength={6}
        required
        autoFocus
        minLength={kid ? 4 : 6}
        placeholder={kid ? "4–6 digits" : "6 digits"}
        aria-label="New PIN"
        className="min-h-11 w-24 rounded-md border border-input px-2 py-1 text-xs focus:border-ring focus:outline-none sm:min-h-0"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-60 sm:min-h-0"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:underline sm:min-h-0"
      >
        {state.success ? "Done" : "Cancel"}
      </button>
      {state.error && <span className="w-full text-xs text-destructive">{state.error}</span>}
      {state.success && <span className="w-full text-xs text-emerald-600">PIN saved.</span>}
    </form>
  );
}
