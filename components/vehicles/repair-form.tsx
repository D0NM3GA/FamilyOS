"use client";

import { useEffect, useId, useRef, useState } from "react";
import { closeOnEscape, useInlineForm } from "@/components/inline-form";
import { useKeptActionState } from "@/components/keep-typed";
import type { VehicleFormState } from "@/app/(app)/vehicles/actions";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";

type LogRepairAction = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

/**
 * Phase 65b: "+ Log a repair" on a car's page: a one-off fix (a battery, a windshield) with its
 * cost, counted in the car's costs. Remounts each time it opens, so an old error never lingers.
 */
export function RepairForm({ logRepair, todayInputValue, currentMileage }: { logRepair: LogRepairAction; todayInputValue: string; currentMileage: number }) {
  const { open, show, close, opener } = useInlineForm();
  const [instance, setInstance] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={opener}
          type="button"
          className={btn}
          onClick={() => {
            setInstance((n) => n + 1);
            setSaved(null);
            show();
          }}
        >
          + Log a repair
        </button>
        {saved && (
          <p role="status" className="text-sm font-bold text-emerald-600">
            {saved}
          </p>
        )}
      </div>
    );
  }
  return (
    <Fields
      key={instance}
      logRepair={logRepair}
      todayInputValue={todayInputValue}
      currentMileage={currentMileage}
      onCancel={close}
      onSaved={(notice) => {
        close();
        setSaved(notice ?? "Repair logged ✓");
      }}
    />
  );
}

function Fields({
  logRepair,
  todayInputValue,
  currentMileage,
  onCancel,
  onSaved,
}: {
  logRepair: LogRepairAction;
  todayInputValue: string;
  currentMileage: number;
  onCancel: () => void;
  onSaved: (notice?: string) => void;
}) {
  const [state, formAction, pending, formRef] = useKeptActionState(logRepair, {});
  const wasPending = useRef(false);
  const id = useId();
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) onSaved(state.notice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error]);

  return (
    <form ref={formRef} action={formAction} onKeyDown={closeOnEscape(onCancel)} className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/50 p-3">
      <div className="min-w-[12rem] flex-1">
        <label htmlFor={`${id}-title`} className={`block ${fieldLabel}`}>
          What was fixed
        </label>
        <input id={`${id}-title`} name="title" required maxLength={120} placeholder="e.g. New battery" className={`mt-1 w-full ${field}`} />
      </div>
      <div>
        <label htmlFor={`${id}-date`} className={`block ${fieldLabel}`}>
          Date
        </label>
        <input id={`${id}-date`} type="date" name="doneAt" defaultValue={todayInputValue} max={todayInputValue} className={`mt-1 ${field}`} />
      </div>
      <div>
        <label htmlFor={`${id}-mileage`} className={`block ${fieldLabel}`}>
          Mileage
        </label>
        <input id={`${id}-mileage`} type="number" inputMode="numeric" name="mileage" min={0} placeholder={String(currentMileage)} className={`mt-1 w-28 ${field}`} />
      </div>
      <div>
        <label htmlFor={`${id}-cost`} className={`block ${fieldLabel}`}>
          Cost
        </label>
        <input id={`${id}-cost`} type="text" name="cost" inputMode="decimal" placeholder="$0.00" className={`mt-1 w-24 ${field}`} />
      </div>
      <div className="min-w-[8rem] flex-1">
        <label htmlFor={`${id}-notes`} className={`block ${fieldLabel}`}>
          Notes (optional)
        </label>
        <input id={`${id}-notes`} name="notes" maxLength={500} className={`mt-1 w-full ${field}`} />
      </div>
      {state.error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}
