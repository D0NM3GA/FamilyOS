"use client";

import { useActionState, useId } from "react";
import { btnPrimary, field, fieldLabel } from "@/components/styles";
import type { FeedFormState } from "./actions";

const box = `mt-1 w-full ${field}`;

export function AddFeedForm({
  action,
  students,
}: {
  action: (prev: FeedFormState, fd: FormData) => Promise<FeedFormState>;
  students: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FeedFormState, FormData>(action, {});
  const hintId = useId();
  return (
    <form action={formAction} className="max-w-lg space-y-3">
      <label className="block">
        <span className={fieldLabel}>Name</span>
        <input name="name" required placeholder="Lincoln Elementary calendar" className={box} />
      </label>
      <div>
        <label className="block">
          <span className={fieldLabel}>Feed address</span>
          <input
            name="url"
            required
            inputMode="url"
            placeholder="webcal://… or https://….ics"
            className={box}
            autoComplete="off"
            aria-describedby={hintId}
          />
        </label>
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          On the school website, look for &ldquo;Subscribe&rdquo;, &ldquo;iCal&rdquo; or &ldquo;Add to calendar&rdquo; and copy that link.
          It&apos;s stored encrypted and never shown again.
        </p>
      </div>
      <label className="block">
        <span className={fieldLabel}>For</span>
        <select name="kidPersonId" defaultValue="" className={box}>
          <option value="">The whole family</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Checking the feed…" : "Add feed"}
      </button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.notice && <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.notice}</p>}
    </form>
  );
}
