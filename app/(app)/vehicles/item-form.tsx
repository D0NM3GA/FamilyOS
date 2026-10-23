"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { btn, btnPrimary, field, fieldLabel, iconBtn } from "@/components/styles";
import type { VehicleFormState } from "./actions";

type Action = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

type Defaults = {
  title?: string;
  notes?: string | null;
  intervalMiles?: number | null;
  intervalMonths?: number | null;
  uses?: { supplyId: string; quantity: number }[];
};

/** A garage supply the item can use (Phase 12.5); `label` includes its unit. */
export type SupplyOption = { id: string; label: string };

export function MaintenanceItemForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
  supplyOptions,
}: {
  action: Action;
  defaults?: Defaults;
  submitLabel: string;
  cancelHref: string;
  supplyOptions: SupplyOption[];
}) {
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(action, {});

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field label="Item" name="title" defaultValue={defaults?.title} placeholder="e.g. Oil change" required />

      <label className="block">
        <span className={fieldLabel}>Notes</span>
        <textarea
          name="notes"
          defaultValue={defaults?.notes ?? ""}
          rows={2}
          placeholder="e.g. Full synthetic"
          className={`mt-1 w-full ${field}`}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Every N miles"
          name="intervalMiles"
          type="number"
          defaultValue={defaults?.intervalMiles ? String(defaults.intervalMiles) : ""}
        />
        <Field
          label="Every N months"
          name="intervalMonths"
          type="number"
          defaultValue={defaults?.intervalMonths ? String(defaults.intervalMonths) : ""}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Set one or both — with both, it&apos;s due at whichever comes first (e.g. 5,000 mi or 6 months).
      </p>

      <SupplyUsesEditor options={supplyOptions} initial={defaults?.uses ?? []} />

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={cancelHref} className={btn}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        className={`mt-1 w-full ${field}`}
      />
    </label>
  );
}

/**
 * "Uses" rows: which garage supplies one service of this item takes, and how much. Logging
 * the service takes them from stock (Phase 12.5). Submits parallel useSupplyId/useQuantity
 * fields; a row left on "Pick a supply" is ignored.
 */
function SupplyUsesEditor({ options, initial }: { options: SupplyOption[]; initial: { supplyId: string; quantity: number }[] }) {
  const [rows, setRows] = useState(() =>
    initial.map((u, i) => ({ key: i, supplyId: u.supplyId, quantity: String(u.quantity) })),
  );
  const [nextKey, setNextKey] = useState(initial.length);

  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        To have a service count down oil, filters and the like,{" "}
        <Link href="/vehicles/supplies" className="font-bold text-brand-text hover:underline">
          add garage supplies
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <fieldset>
      <legend className={fieldLabel}>Uses from garage supplies</legend>
      <div className="mt-1 space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex gap-2">
            <select
              name="useSupplyId"
              aria-label="Supply"
              defaultValue={row.supplyId}
              className={`min-w-0 flex-1 ${field}`}
            >
              <option value="">Pick a supply</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              name="useQuantity"
              aria-label="Amount per service"
              type="number"
              step="any"
              min="0"
              defaultValue={row.quantity}
              placeholder="Amount"
              className={`w-24 ${field}`}
            />
            <button
              type="button"
              aria-label="Remove this supply"
              onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              className={iconBtn}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          setRows((rs) => [...rs, { key: nextKey, supplyId: "", quantity: "" }]);
          setNextKey((k) => k + 1);
        }}
        className={`mt-2 ${btn}`}
      >
        + Supply
      </button>
    </fieldset>
  );
}
