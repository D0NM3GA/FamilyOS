"use client";

import { useActionState, useState } from "react";
import { field } from "@/components/styles";
import type { RenamePasskeyState } from "./actions";

type Action = (prevState: RenamePasskeyState, formData: FormData) => Promise<RenamePasskeyState>;

/** Inline "Rename" for one passkey (Phase 40.2a), like Settings → Household's PIN control. */
export function RenamePasskey({ action, name }: { action: Action; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<RenamePasskeyState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.success) setOpen(false);
    return result;
  }, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-xs font-medium text-brand-text hover:underline sm:min-h-0"
      >
        Rename
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
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
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-60 sm:min-h-0"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:underline sm:min-h-0">
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
