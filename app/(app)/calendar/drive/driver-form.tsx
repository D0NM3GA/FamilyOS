"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { SubmitButton } from "@/components/submit";
import { btnPrimary } from "@/components/styles";
import { chooseDriver, type DriverState } from "./actions";

/** Phase 70b: the grown-ups as choices, and "Nobody yet". */
export function DriverForm({ calendarId, graphId, week, driverId, drivers }: { calendarId: string; graphId: string; week: string; driverId: string | null; drivers: { id: string; name: string }[] }) {
  const [state, action, , keptForm] = useKeptActionState<DriverState>(chooseDriver, {});
  return (
    <form ref={keptForm} action={action} className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <input type="hidden" name="c" value={calendarId} />
      <input type="hidden" name="g" value={graphId} />
      <input type="hidden" name="week" value={week} />
      <fieldset className="space-y-1">
        <legend className="mb-2 text-sm font-medium text-foreground">Who&apos;s driving?</legend>
        {drivers.map((d) => (
          <label key={d.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
            <input type="radio" name="driver" value={d.id} defaultChecked={driverId === d.id} className="size-4" />
            <span className="text-sm text-foreground">{d.name}</span>
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
          <input type="radio" name="driver" value="" defaultChecked={!driverId} className="size-4" />
          <span className="text-sm text-foreground">Nobody yet</span>
        </label>
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm font-bold text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton className={btnPrimary} pendingText="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
