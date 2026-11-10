"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { closeOnEscape, useInlineForm } from "@/components/inline-form";
import { field } from "@/components/styles";
import type { RenamePasskeyState } from "./actions";

type Action = (prevState: RenamePasskeyState, formData: FormData) => Promise<RenamePasskeyState>;

/** Inline "Rename" for one passkey (Phase 40.2a), like Settings → Household's PIN control. */
export function RenamePasskey({ action, name }: { action: Action; name: string }) {
  const { open, show, close, opener } = useInlineForm();
  const [state, formAction, pending, keptForm] = useKeptActionState<RenamePasskeyState>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.success) close();
    return result;
  }, {});

  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        onClick={show}
        className="inline-flex min-h-11 items-center text-xs font-medium text-brand-text hover:underline sm:min-h-0"
      >
        Rename
      </button>
    );
  }

  return (
    <form ref={keptForm} action={formAction} onKeyDown={closeOnEscape(close)} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        defaultValue={name}
        required
        maxLength={40}
        autoFocus
        aria-label="Passkey name"
        className={`${field} w-40 text-xs`}
      />
      <button
        type="submit"
        disabled={pending}
        className="ui-btn ui-btn-primary inline-flex min-h-11 items-center rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:opacity-60 sm:min-h-0"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={close} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:underline sm:min-h-0">
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
