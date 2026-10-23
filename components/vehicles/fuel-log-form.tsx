"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { VehicleFormState } from "@/app/(app)/vehicles/actions";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";

type LogFuelAction = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

/**
 * "Log a fill-up" on the vehicle detail page. Open to every household member (kids
 * included — the owner's call for Phase 12). Same open/remount-per-open shape as
 * OdometerForm, so a previous attempt's error never lingers into the next. Kids don't get
 * the cost field (Phase 27: kids never see money; logFuel ignores a kid's cost anyway).
 */
export function FuelLogForm({
  logFuel,
  todayInputValue,
  currentMileage,
  showCost,
}: {
  logFuel: LogFuelAction;
  /** "YYYY-MM-DD", precomputed server-side. */
  todayInputValue: string;
  currentMileage: number;
  showCost: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [formInstance, setFormInstance] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  // Set when the save succeeded but the odometer wasn't moved (logFuel's jump cap) — stays
  // up until the form is reopened, unlike the brief "Logged ✓", since it asks for follow-up.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setFormInstance((n) => n + 1);
            setNotice(null);
            setOpen(true);
          }}
          className={btnPrimary}
        >
          ⛽ Log fill-up
        </button>
        {justSaved && !notice && <span className="text-xs font-bold text-emerald-600">Logged ✓</span>}
        {notice && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{notice}</span>}
      </div>
    );
  }

  return (
    <FuelLogFormInner
      key={formInstance}
      logFuel={logFuel}
      todayInputValue={todayInputValue}
      currentMileage={currentMileage}
      showCost={showCost}
      onCancel={() => setOpen(false)}
      onSuccess={(n) => {
        setOpen(false);
        setJustSaved(true);
        setNotice(n ?? null);
      }}
    />
  );
}

function FuelLogFormInner({
  logFuel,
  todayInputValue,
  currentMileage,
  showCost,
  onCancel,
  onSuccess,
}: {
  logFuel: LogFuelAction;
  todayInputValue: string;
  currentMileage: number;
  showCost: boolean;
  onCancel: () => void;
  onSuccess: (notice?: string) => void;
}) {
  const [state, formAction, pending] = useActionState(logFuel, {});
  const wasPending = useRef(false);
  const id = useId();

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) onSuccess(state.notice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error]);

  const input = `mt-1 ${field}`;
  const label = `block ${fieldLabel}`;

  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2 rounded-xl bg-card p-3 ring-1 ring-border">
      <div>
        <label htmlFor={`${id}-date`} className={label}>
          Date
        </label>
        <input id={`${id}-date`} type="date" name="filledAt" defaultValue={todayInputValue} max={todayInputValue} className={input} />
      </div>
      <div>
        <label htmlFor={`${id}-mileage`} className={label}>
          Odometer
        </label>
        <input
          id={`${id}-mileage`}
          type="number"
          name="mileage"
          required
          min={0}
          max={9_999_999}
          // A placeholder, not a prefilled value: prefilling the last reading means an
          // unedited submit logs a duplicate-mileage fill-up (flagged "check mileage").
          placeholder={currentMileage.toLocaleString("en-US")}
          className={`${input} w-28`}
        />
      </div>
      <div>
        <label htmlFor={`${id}-gallons`} className={label}>
          Gallons
        </label>
        <input id={`${id}-gallons`} type="number" name="gallons" required min={0.001} max={500} step={0.001} className={`${input} w-24`} />
      </div>
      {showCost && (
        <div>
          <label htmlFor={`${id}-cost`} className={label}>
            Total cost (optional)
          </label>
          <input id={`${id}-cost`} type="text" name="cost" inputMode="decimal" placeholder="$0.00" className={`${input} w-24`} />
        </div>
      )}
      <div className="min-w-[8rem] flex-1">
        <label htmlFor={`${id}-notes`} className={label}>
          Notes (optional)
        </label>
        <input id={`${id}-notes`} type="text" name="notes" placeholder="e.g. Costco" className={`${input} w-full`} />
      </div>
      <div className="flex w-full flex-wrap gap-x-4 text-sm text-muted-foreground">
        <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
          <input type="checkbox" name="fullTank" defaultChecked className="size-4" /> Filled to full
        </label>
        <label
          className="flex min-h-11 items-center gap-2 sm:min-h-0"
          title="Tick this if the fill-up before this one wasn't logged, so MPG isn't computed across the gap"
        >
          <input type="checkbox" name="missedPrevious" className="size-4" /> Missed logging the last fill-up
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
      {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
