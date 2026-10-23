"use client";

import { useActionState, useEffect, useRef } from "react";
import { btnPrimary, field, fieldLabel } from "@/components/styles";
import { adjustStickersAction, type AdjustState } from "../actions";

/** A grown-up's bonus or take-back for one person. */
export function AdjustForm({ personId, firstName }: { personId: string; firstName: string }) {
  const [state, formAction, pending] = useActionState<AdjustState, FormData>(adjustStickersAction.bind(null, personId), {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className={`${fieldLabel} mb-1`}>Give or take</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink/20 px-3 text-sm font-bold has-[:checked]:border-ink has-[:checked]:bg-lime has-[:checked]:text-ink dark:border-white/20">
          <input type="radio" name="direction" value="give" defaultChecked className="sr-only" />⭐ Give {firstName} some
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-ink/20 px-3 text-sm font-bold has-[:checked]:border-ink has-[:checked]:bg-tomato has-[:checked]:text-ink dark:border-white/20">
          <input type="radio" name="direction" value="take" className="sr-only" />↩︎ Take some back
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>How many</span>
          <input name="amount" type="number" inputMode="numeric" min={1} max={500} required defaultValue={5} className={`${field} w-28`} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={fieldLabel}>What for</span>
          <input name="reason" required maxLength={80} placeholder="Helped Grandma move" className={field} />
        </label>
      </div>
      {state.error && (
        <p role="alert" className="text-sm font-bold text-destructive">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Saving…" : state.saved ? "Done ✓ — another?" : "Save"}
      </button>
    </form>
  );
}
