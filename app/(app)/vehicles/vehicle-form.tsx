"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import { VinScanner } from "@/components/vehicles/vin-scanner";
import { useCameraSupported } from "@/components/camera";
import type { VinDecode } from "@/lib/vehicles/vpic";
import type { VehicleFormState } from "./actions";

type Action = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

type Defaults = {
  name?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  currentMileage?: number;
};

export function VehicleForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
  lookUpVin,
}: {
  action: Action;
  defaults?: Defaults;
  submitLabel: string;
  cancelHref: string;
  lookUpVin: (vin: string) => Promise<VinDecode>;
}) {
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(action, {});
  // Phase 53: a VIN fills make, model and year (each still editable), typed or scanned.
  const [vin, setVin] = useState(defaults?.vin ?? "");
  const [make, setMake] = useState(defaults?.make ?? "");
  const [model, setModel] = useState(defaults?.model ?? "");
  const [year, setYear] = useState(defaults?.year ? String(defaults.year) : "");
  const [found, setFound] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [looking, look] = useTransition();
  const camera = useCameraSupported();

  const lookUp = (value: string) =>
    look(async () => {
      const r = await lookUpVin(value);
      if (r.status === "ok") {
        setMake(r.make);
        if (r.model) setModel(r.model);
        if (r.year) setYear(String(r.year));
        const extra = [r.trim, r.engine].filter(Boolean).join(", ");
        setFound(`${r.year ?? ""} ${r.make} ${r.model ?? ""}${extra ? ` (${extra})` : ""}`.replace(/\s+/g, " ").trim() + (r.partial ? ". Part of the VIN didn't read: check these." : "."));
      } else if (r.status === "invalid") setFound(r.error);
      else if (r.status === "unreadable") setFound("NHTSA couldn't read that VIN. Check it, or fill in the car yourself.");
      else setFound("Couldn't reach NHTSA just now. Fill in the car yourself, or try again later.");
    });

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field label="Name" name="name" defaultValue={defaults?.name} placeholder="e.g. Mom's minivan" required />
      <div className="space-y-2">
        <label className="block min-w-0">
          <span className={fieldLabel}>VIN (optional)</span>
          <input
            name="vin"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="vin-found"
            className={`mt-1 w-full font-mono ${field}`}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={looking || !vin.trim()} onClick={() => lookUp(vin)}>
            {looking ? "Looking it up…" : "Look it up"}
          </button>
          {camera && !scanning && (
            <button type="button" className={btn} onClick={() => setScanning(true)}>
              Scan the VIN
            </button>
          )}
        </div>
        {scanning && (
          <VinScanner
            onVin={(v) => {
              setScanning(false);
              setVin(v);
              lookUp(v);
            }}
            onDone={() => setScanning(false)}
          />
        )}
        <p id="vin-found" className="text-xs text-muted-foreground" aria-live="polite">
          {found ?? "On the driver's door frame, the windshield's corner, or the insurance card. It fills in the car for you."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Make" name="make" value={make} onChange={setMake} />
        <Field label="Model" name="model" value={model} onChange={setModel} />
        <Field label="Year" name="year" type="number" value={year} onChange={setYear} />
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
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>{label}</span>
      <input
        type={type}
        name={name}
        {...(onChange ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : { defaultValue })}
        required={required}
        placeholder={placeholder}
        className={`mt-1 w-full ${field}`}
      />
    </label>
  );
}
