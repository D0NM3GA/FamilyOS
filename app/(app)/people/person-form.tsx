"use client";

import Link from "next/link";
import { useState } from "react";
import { useKeptActionState } from "@/components/keep-typed";
import type { PersonFormState } from "./actions";
import type { PersonColor } from "@/app/generated/prisma/enums";
import { PERSON_COLORS, PERSON_COLOR_KEYS } from "@/lib/person-color";
import { MoreOptions } from "@/components/more-options";
import { formActions, btn, btnPrimary, field, fieldLabel } from "@/components/styles";

type Action = (prevState: PersonFormState, formData: FormData) => Promise<PersonFormState>;

type Defaults = {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  notesAdultsOnly?: boolean;
  isHouseholdMember?: boolean;
  role?: "ADULT" | "KID" | "ADMIN" | null;
  /**
   * This person's membership and role aren't the form's to change (their own sign-in, or a
   * restored Admin or jar member who will have one; lib/household-members.ts isMembershipLocked).
   * actions.ts keeps both as they are, so the form shows them fixed.
   */
  membershipLocked?: boolean;
  /** The viewer isn't an Admin, so membership and role are shown but not changeable (actions.ts). */
  adminOnly?: boolean;
  /** Their role comes from Entra (a Microsoft sign-in), which the fixed role line says. */
  onMicrosoft?: boolean;
  contactCadenceDays?: number | null;
  color?: PersonColor | null;
};

export function PersonForm({
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
  const [state, formAction, pending, formRef] = useKeptActionState<PersonFormState>(action, {});
  const [isMember, setIsMember] = useState(defaults?.isHouseholdMember ?? false);
  const fixed = defaults?.membershipLocked || defaults?.adminOnly;
  const roleLabel = defaults?.role === "ADMIN" ? "Admin" : defaults?.role === "KID" ? "Kid" : "Adult";

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" name="firstName" defaultValue={defaults?.firstName} required />
        <Field label="Last name" name="lastName" defaultValue={defaults?.lastName ?? ""} />
      </div>

      <Field label="Email" name="email" type="email" defaultValue={defaults?.email ?? ""} />
      <Field label="Phone" name="phone" type="tel" defaultValue={defaults?.phone ?? ""} />

      <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-9">
        <input
          type="checkbox"
          name="isHouseholdMember"
          defaultChecked={isMember}
          disabled={fixed}
          aria-describedby={defaults?.adminOnly ? "member-admin-only" : undefined}
          onChange={(e) => setIsMember(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        Lives in our household
      </label>
      {defaults?.adminOnly && (
        <p id="member-admin-only" className="-mt-2 text-xs text-muted-foreground">
          Only an Admin can change who lives in the household, or their role.
        </p>
      )}
      {/* A disabled box isn't sent; this sends what it shows (the action keeps it anyway). */}
      {fixed && isMember && <input type="hidden" name="isHouseholdMember" value="on" />}

      {isMember && fixed ? (
        <div>
          <p className={fieldLabel}>Role</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {roleLabel}
            {defaults?.onMicrosoft && defaults.membershipLocked ? " — set via Microsoft sign-in, not editable here." : " — not editable here."}
          </p>
        </div>
      ) : (
        isMember && (
          <label className="block">
            <span className={`${fieldLabel} block`}>Role</span>
            <select
              name="role"
              defaultValue={defaults?.role ?? "ADULT"}
              className={`${field} mt-1 w-full`}
            >
              <option value="ADULT">Adult</option>
              <option value="KID">Kid</option>
            </select>
          </label>
        )
      )}

      {isMember && (
        <fieldset>
          <legend className={fieldLabel}>Sticker color</legend>
          <p className="text-xs text-muted-foreground">Leave unpicked for an automatic color.</p>
          {/* The padding, not the 36px swatch, is the 44px thumb target. */}
          <div className="-ml-1 mt-1 flex flex-wrap">
            {PERSON_COLOR_KEYS.map((key) => (
              <label key={key} className="cursor-pointer p-1" title={PERSON_COLORS[key].label}>
                <input
                  type="radio"
                  name="color"
                  value={key}
                  defaultChecked={defaults?.color === key}
                  className="peer sr-only"
                />
                <span
                  className="block size-9 rounded-full border-2 border-ink shadow-[0_0_0_3px_#fff] transition peer-checked:scale-110 peer-checked:ring-4 peer-checked:ring-ink/60 dark:peer-checked:ring-sun peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
                  style={{ backgroundColor: PERSON_COLORS[key].bg }}
                />
                <span className="sr-only">{PERSON_COLORS[key].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <MoreOptions open={Boolean(defaults) || Boolean(state.error)} summary="Notes, check-in reminder">
        <label className="block">
          <span className={`${fieldLabel} block`}>Notes</span>
          <textarea
            name="notes"
            defaultValue={defaults?.notes ?? ""}
            rows={3}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          <input type="checkbox" name="notesAdultsOnly" defaultChecked={defaults?.notesAdultsOnly ?? false} className="size-4" />
          🔒 Notes are for grown-ups only (kids don&apos;t see them)
        </label>
  
        <div>
          <label className="block">
            <span className={`${fieldLabel} block`}>Check-in reminder (days)</span>
            <input
              type="number" inputMode="numeric"
              name="contactCadenceDays"
              min={0}
              max={3650}
              defaultValue={defaults?.contactCadenceDays ?? ""}
              placeholder="21"
              className={`${field} mt-1 w-full`}
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            How often Home&apos;s &ldquo;Haven&apos;t talked in a while&rdquo; card reminds you about
            them; 0 means never. Household members are left out unless you set this, say for a kid away at
            college. A med&apos;s doctor or pharmacy and school contacts never show there.
          </p>
        </div>
      </MoreOptions>

      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

      <div data-covers-bottom className={formActions}>
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
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className={`${fieldLabel} block`}>{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className={`${field} mt-1 w-full`}
      />
    </label>
  );
}
