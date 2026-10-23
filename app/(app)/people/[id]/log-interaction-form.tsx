"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { btnPrimary, field } from "@/components/styles";
import { logInteraction, type FormState } from "./actions";
import { INTERACTION_TYPES } from "./interaction-list";

/** `today` comes from the server ("YYYY-MM-DD"), so the date box starts on the same day it checks against. */
export function LogInteractionForm({ personId, today, canHide }: { personId: string; today: string; canHide: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(logInteraction.bind(null, personId), {});
  const formRef = useRef<HTMLFormElement>(null);
  // "Logged ✓" shows for the latest save until its timer marks it seen.
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const logged = state.saved !== undefined && state.saved !== seen;

  useEffect(() => {
    if (!state.saved) return;
    formRef.current?.reset();
    const saved = state.saved;
    const timer = setTimeout(() => setSeen(saved), 2500);
    return () => clearTimeout(timer);
  }, [state.saved]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-2 rounded-lg bg-card p-3 shadow-sm ring-1 ring-border">
      <select name="type" aria-label="Kind of contact" className={field}>
        {INTERACTION_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        name="when"
        type="date"
        defaultValue={today}
        max={today}
        aria-label="When it happened"
        title="When it happened (yesterday's call counts too)"
        className={field}
      />
      <input name="note" placeholder="What happened? (optional)" aria-label="What happened? (optional)" className={`${field} min-w-48 flex-1`} />
      {canHide && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground sm:min-h-9">
          <input type="checkbox" name="adultsOnly" className="size-4" />
          🔒 Grown-ups only
        </label>
      )}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Logging…" : logged ? "Logged ✓" : "Log it"}
      </button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
