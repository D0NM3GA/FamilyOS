"use client";

import { useActionState, useState } from "react";
import { closeOnEscape, useInlineForm } from "@/components/inline-form";
import type { PinFormState } from "./actions";

type Action = (prevState: PinFormState, formData: FormData) => Promise<PinFormState>;

/**
 * Inline "Set PIN" control for one member row. The page passes only whether a PIN exists,
 * never the hash itself.
 */
export function PinForm({ action, hasPin, kid }: { action: Action; hasPin: boolean; kid: boolean }) {
  const { open, show, close, opener } = useInlineForm();
  const [state, formAction, pending] = useActionState<PinFormState, FormData>(action, {});
  // The answer from before it was last opened: a fresh, empty box doesn't say "PIN saved."
  const [shownBefore, setShownBefore] = useState<PinFormState | null>(null);
  const fresh = state !== shownBefore;

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{hasPin || state.success ? "Set" : "Not set"}</span>
        <button
          ref={opener}
          type="button"
          onClick={() => {
            setShownBefore(state);
            show();
          }}
          className="inline-flex min-h-11 items-center text-xs font-medium text-brand-text hover:underline sm:min-h-0"
        >
          {hasPin || state.success ? "Change" : "Set PIN"}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} onKeyDown={closeOnEscape(close)} className="flex flex-wrap items-center gap-2">
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
        className="ui-btn ui-btn-primary inline-flex min-h-11 items-center rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:opacity-60 sm:min-h-0"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={close}
        className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:underline sm:min-h-0"
      >
        {fresh && state.success ? "Done" : "Cancel"}
      </button>
      {fresh && state.error && <span role="alert" className="w-full text-xs text-destructive">{state.error}</span>}
      {fresh && state.success && <span role="status" className="w-full text-xs text-emerald-600">PIN saved.</span>}
    </form>
  );
}
