"use client";

import { useActionState } from "react";
import { btn, field } from "@/components/styles";
import type { SupplyFormState } from "./actions";

/** The supplies table's inline "+ stock" control. */
export function StockForm({
  action,
  unit,
  name,
}: {
  action: (prev: SupplyFormState, formData: FormData) => Promise<SupplyFormState>;
  unit: string | null;
  /** The supply's name, so each row's box and button say which supply they restock. */
  name: string;
}) {
  const [state, formAction, pending] = useActionState<SupplyFormState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="amount"
        type="number"
        step="any"
        min="0"
        required
        aria-label={`Amount of ${name} to add${unit ? ` (${unit})` : ""}`}
        placeholder="+"
        className={`w-20 ${field}`}
      />
      <button type="submit" disabled={pending} aria-label={`Add stock: ${name}`} className={btn}>
        Add stock
      </button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
