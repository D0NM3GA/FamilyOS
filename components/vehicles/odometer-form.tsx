"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { VehicleFormState } from "@/app/(app)/vehicles/actions";
import { btn, btnPrimary, field } from "@/components/styles";

type UpdateOdometerAction = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

/**
 * The board's quick odometer control. A plain server-action form can't surface the
 * "must be at least the current reading" rejection from updateOdometer (this app has no
 * error.tsx, so a thrown error is an unrecoverable 500 — see docs/BUILD.md) — hence
 * useActionState here instead of a bare <form action={updateOdometer.bind(...)}>.
 */
export function OdometerForm({
  currentMileage,
  updateOdometer,
}: {
  currentMileage: number;
  updateOdometer: UpdateOdometerAction;
}) {
  const [open, setOpen] = useState(false);
  // Bumped each time the form re-opens, and used as its key — a fresh mount per open means
  // a fresh useActionState, so a previous attempt's error can't linger into the next one.
  const [formInstance, setFormInstance] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setFormInstance((n) => n + 1);
            setOpen(true);
          }}
          className={btn}
        >
          Update odometer
        </button>
        {justSaved && <span className="text-xs font-bold text-emerald-600">Saved ✓</span>}
      </div>
    );
  }

  return (
    <OdometerFormInner
      key={formInstance}
      currentMileage={currentMileage}
      updateOdometer={updateOdometer}
      onCancel={() => setOpen(false)}
      onSuccess={() => {
        setOpen(false);
        setJustSaved(true);
      }}
    />
  );
}

function OdometerFormInner({
  currentMileage,
  updateOdometer,
  onCancel,
  onSuccess,
}: {
  currentMileage: number;
  updateOdometer: UpdateOdometerAction;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateOdometer, {});
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error]);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        name="mileage"
        autoFocus
        defaultValue={currentMileage}
        min={currentMileage}
        aria-label="Odometer (miles)"
        className={`w-28 ${field}`}
      />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} className={btn}>
        Cancel
      </button>
      {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
