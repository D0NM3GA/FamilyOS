"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit";
import { btnPrimary, chip, field, fieldLabel } from "@/components/styles";
import { addFamilyMember, type AddMemberState } from "./actions";

const KINDS = [
  { id: "kid", label: "Kid", what: "Gets a tile on the profile picker, plus chores, rewards and meds. No sign-in of their own." },
  { id: "adult", label: "Grown-up", what: "Signs in on their own with a passkey, and sees the money. You'll get an invite link to send at the end." },
  { id: "contact", label: "Grandparent or helper", what: "Shows up in People and on the calendar, for birthdays and pickups. No tile, no sign-in." },
] as const;

/** Phase 45.4: adding someone in the guided setup, with a line on what each role gets. */
export function AddMember() {
  const [state, formAction] = useActionState<AddMemberState, FormData>(addFamilyMember, {});
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("kid");
  const chosen = KINDS.find((k) => k.id === kind)!;
  return (
    <form action={formAction} key={state.at} className="space-y-3 rounded-2xl bg-muted p-4">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-[1_1_12rem]">
          <span className={`${fieldLabel} block`}>First name</span>
          <input name="firstName" required maxLength={40} autoComplete="off" className={`${field} mt-1 w-full`} />
        </label>
        <div role="group" aria-label="Who are they?" className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} className={chip} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <SubmitButton className={btnPrimary} pendingText="Adding…">
          Add
        </SubmitButton>
      </div>
      <p aria-live="polite" className="text-sm text-foreground">
        <span className="font-bold">{chosen.label}:</span> {chosen.what}
      </p>
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      {state.added && (
        <p role="status" className="text-sm text-foreground">
          Added {state.added.name}.
        </p>
      )}
    </form>
  );
}
