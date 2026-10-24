"use client";

import { useActionState, useState } from "react";
import type { HouseholdSettingsFormState } from "./actions";
import { useDeviceTimeZone } from "@/components/device-time-zone";

type Action = (
  prevState: HouseholdSettingsFormState,
  formData: FormData,
) => Promise<HouseholdSettingsFormState>;

export function HouseholdSettingsForm({
  action,
  defaults,
  timeZones,
}: {
  action: Action;
  defaults: { name: string; timezone: string | null; statementDateOrder: "AUTO" | "MONTH_FIRST" | "DAY_FIRST" };
  timeZones: string[];
}) {
  const [state, formAction, pending] = useActionState<HouseholdSettingsFormState, FormData>(
    action,
    {},
  );
  const [timezone, setTimezone] = useState(defaults.timezone ?? "");
  const device = useDeviceTimeZone();
  // The saved zone stays pickable even if this server's list doesn't have it.
  const zones = timezone && !timeZones.includes(timezone) ? [timezone, ...timeZones] : timeZones;

  return (
    <form action={formAction} className="max-w-lg space-y-4 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <div>
        <label htmlFor="household-name" className="block text-sm font-medium text-foreground">Household name</label>
        <input
          id="household-name"
          type="text"
          name="name"
          defaultValue={defaults.name}
          required
          className="mt-1 min-h-11 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none sm:min-h-9"
        />
      </div>

      <div>
        <label htmlFor="household-timezone" className="block text-sm font-medium text-foreground">Timezone</label>
        <select
          id="household-timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-ring focus:outline-none sm:min-h-9"
        >
          <option value="">Not set</option>
          {zones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
          {device && timezone === device
            ? "Matches this device. "
            : device
              ? `This device is on ${device.replace(/_/g, " ")}. `
              : ""}
          {device && timezone !== device && (
            <button type="button" className="underline hover:text-foreground" onClick={() => setTimezone(device)}>
              Use this device&apos;s
            </button>
          )}
        </p>
      </div>

      {/* Phase 52: how a statement file's ambiguous dates read (lib/finance/statement-columns.ts). */}
      <div>
        <label htmlFor="household-date-order" className="block text-sm font-medium text-foreground">Date order in statement files</label>
        <select
          id="household-date-order"
          name="statementDateOrder"
          defaultValue={defaults.statementDateOrder}
          aria-describedby="household-date-order-hint"
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-ring focus:outline-none sm:min-h-9"
        >
          <option value="AUTO">Automatic: the standard where you live (month first in the US)</option>
          <option value="MONTH_FIRST">Month first (03/10 is March 10)</option>
          <option value="DAY_FIRST">Day first (03/10 is 3 October)</option>
        </select>
        <p id="household-date-order-hint" className="mt-1 text-xs text-muted-foreground">
          Only for a bank or card file whose dates could be read either way. The import check shows the order it used.
        </p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95 disabled:opacity-60 sm:min-h-9"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
