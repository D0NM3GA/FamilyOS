"use client";

import { useActionState, useEffect, useRef } from "react";
import { ConfirmSubmit, SubmitButton } from "@/components/submit";
import { btn, btnPrimary, field, sectionTitle } from "@/components/styles";
import type { GiftIdeaRow } from "@/lib/gift-ideas";
import { addGiftIdeaAction, removeGiftIdeaAction, setGiftGivenAction, type GiftState } from "./actions";

/**
 * Phase 70d: gift ideas for this person, for the grown-ups (never shown to the person themselves).
 * The open ones go in their birthday reminder; a given one stays, crossed off.
 */
export function GiftIdeas({ personId, firstName, ideas }: { personId: string; firstName: string; ideas: GiftIdeaRow[] }) {
  const [state, action] = useActionState<GiftState, FormData>(addGiftIdeaAction.bind(null, personId), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) form.current?.reset();
  }, [state.saved]);
  return (
    <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <h2 className={sectionTitle}>🎁 Gift ideas</h2>
      <p className="mt-1 text-xs text-muted-foreground">Only grown-ups see these, and {firstName} never does. The open ones go in the birthday reminder.</p>
      {ideas.length > 0 && (
        <ul className="mt-2 divide-y divide-border text-sm">
          {ideas.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className={`min-w-0 flex-1 basis-32 ${g.given ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {g.text}
                {g.addedBy && <span className="text-xs text-muted-foreground no-underline"> · {g.addedBy}</span>}
              </span>
              <form action={setGiftGivenAction.bind(null, personId, g.id, !g.given)}>
                <SubmitButton className={btn} aria-label={`${g.given ? "Not given yet" : "Given"}: ${g.text}`}>
                  {g.given ? "Not given yet" : "Given"}
                </SubmitButton>
              </form>
              <form action={removeGiftIdeaAction.bind(null, personId, g.id)}>
                <ConfirmSubmit question={`Remove "${g.text}"?`} yes="Remove" aria-label={`Remove: ${g.text}`}>
                  Remove
                </ConfirmSubmit>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={action} className="mt-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`gift-${personId}`}>
          A gift idea for {firstName}
        </label>
        <input id={`gift-${personId}`} name="text" maxLength={200} required placeholder="Paint set, a book about sharks…" className={`${field} min-w-0 flex-1 basis-48`} />
        <SubmitButton className={btnPrimary}>Add</SubmitButton>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
