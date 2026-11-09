"use client";

import { useKeptActionState } from "@/components/keep-typed";
import Link from "next/link";
import { btn, btnPrimary, field, fieldLabel, formActions } from "@/components/styles";
import type { SupplyFormState } from "./actions";

type Action = (prev: SupplyFormState, formData: FormData) => Promise<SupplyFormState>;

type Defaults = {
  name?: string;
  partNumber?: string | null;
  unit?: string | null;
  quantityOnHand?: number | null;
  lowThreshold?: number | null;
  notes?: string | null;
};

const box = `mt-1 w-full ${field}`;

export function SupplyForm({ action, defaults, submitLabel }: { action: Action; defaults?: Defaults; submitLabel: string }) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SupplyFormState>(action, {});
  const num = (n: number | null | undefined) => (n == null ? "" : String(n));

  return (
    <form ref={keptForm} action={formAction} className="space-y-4">
      <label className="block">
        <span className={fieldLabel}>Name</span>
        <input name="name" required defaultValue={defaults?.name} placeholder="e.g. Motor oil 5W-30" className={box} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className={fieldLabel}>Part number</span>
          <input name="partNumber" defaultValue={defaults?.partNumber ?? ""} placeholder="Optional" className={box} />
        </label>
        <label className="block min-w-0">
          <span className={fieldLabel}>Unit</span>
          <input name="unit" defaultValue={defaults?.unit ?? ""} placeholder="qt, filter, bottle" className={box} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className={fieldLabel}>On hand</span>
          <input name="quantityOnHand" type="number" inputMode="decimal" step="any" min="0" defaultValue={num(defaults?.quantityOnHand)} className={box} />
        </label>
        <label className="block min-w-0">
          <span className={fieldLabel}>Low at</span>
          <input name="lowThreshold" type="number" inputMode="decimal" step="any" min="0" defaultValue={num(defaults?.lowThreshold)} className={box} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave &ldquo;On hand&rdquo; blank to not count this one. When a logged service brings it to &ldquo;Low at&rdquo; or
        below, it goes on the shopping list.
      </p>
      <label className="block">
        <span className={fieldLabel}>Notes</span>
        <textarea name="notes" rows={2} defaultValue={defaults?.notes ?? ""} placeholder="e.g. Fits the van only" className={box} />
      </label>

      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <div data-covers-bottom className={formActions}>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href="/vehicles/supplies" className={btn}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
