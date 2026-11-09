"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { useState } from "react";
import { SubmitButton } from "@/components/submit";
import { btnPrimary, field, fieldLabel } from "@/components/styles";
import { askChoreSwap, type SwapState } from "../actions";

type Choice = { id: string; label: string };

/** Phase 70c: which chore, who to ask, and (optional) one of theirs to do back. */
export function SwapForm({ mine, others }: { mine: Choice[]; others: { id: string; name: string; chores: Choice[] }[] }) {
  const [state, action, , keptForm] = useKeptActionState<SwapState>(askChoreSwap, {});
  const [toId, setToId] = useState(others[0]?.id ?? "");
  const theirs = others.find((o) => o.id === toId);
  return (
    <form ref={keptForm} action={action} className="space-y-4 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>My chore</span>
        <select name="instanceId" required className={field}>
          {mine.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className={`${fieldLabel} mb-1`}>Ask</legend>
        {others.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
            <input type="radio" name="toId" value={o.id} checked={toId === o.id} onChange={() => setToId(o.id)} className="size-4" />
            <span className="text-sm text-foreground">{o.name}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>And I&apos;ll do one of theirs (optional)</span>
        <select key={toId} name="giveBackId" defaultValue="" className={field}>
          <option value="">Nothing back</option>
          {(theirs?.chores ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {state.error && (
        <p role="alert" className="text-sm font-bold text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton className={btnPrimary} pendingText="Asking…">
        Ask
      </SubmitButton>
    </form>
  );
}
