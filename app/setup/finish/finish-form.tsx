"use client";

import { useActionState } from "react";
import { btnPrimary, field, fieldLabel } from "@/components/styles";
import { completeSetup, type FinishState } from "../actions";
import { useDeviceTimeZone } from "@/components/device-time-zone";

/** Names the household (unless the first step already did) and finishes setup. */
export function FinishForm({ kept, householdName, firstName }: { kept: boolean; householdName: string; firstName: string }) {
  const [state, formAction, pending] = useActionState<FinishState, FormData>(completeSetup, {});
  const timezone = useDeviceTimeZone();
  return (
    <form action={formAction} className="space-y-4">
      {/* Phase 45.2: the household starts on this device's time zone. */}
      <input type="hidden" name="timezone" value={timezone ?? ""} />
      {kept ? (
        <>
          <p className="text-sm text-foreground">
            Setting up <strong>{householdName}</strong> with you, {firstName}, as its admin.
          </p>
          {/* Sent along too, in case the kept details expire before this is pressed. */}
          <input type="hidden" name="householdName" value={householdName} />
          <input type="hidden" name="firstName" value={firstName} />
        </>
      ) : (
        <>
          <label className="block">
            <span className={`${fieldLabel} block`}>Your household&apos;s name</span>
            <input name="householdName" required maxLength={60} defaultValue={householdName} placeholder="The Parkers" className={`${field} mt-1 w-full`} />
          </label>
          <label className="block">
            <span className={`${fieldLabel} block`}>Your first name</span>
            <input name="firstName" required maxLength={40} defaultValue={firstName} autoComplete="given-name" className={`${field} mt-1 w-full`} />
          </label>
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${btnPrimary} w-full justify-center`}>
        {pending ? "Setting up…" : "Finish setup"}
      </button>
    </form>
  );
}
