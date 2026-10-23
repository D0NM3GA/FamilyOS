"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import type { VehicleFormState } from "./actions";

type Action = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

type Defaults = {
  name?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  currentMileage?: number;
};

export function VehicleForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  defaults?: Defaults;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(action, {});

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field label="Name" name="name" defaultValue={defaults?.name} placeholder="e.g. Mom's minivan" required />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Make" name="make" defaultValue={defaults?.make ?? ""} />
        <Field label="Model" name="model" defaultValue={defaults?.model ?? ""} />
        <Field label="Year" name="year" type="number" defaultValue={defaults?.year ? String(defaults.year) : ""} />
      </div>
      <Field
        label="Current mileage"
        name="currentMileage"
        type="number"
        defaultValue={String(defaults?.currentMileage ?? 0)}
        required
      />

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
