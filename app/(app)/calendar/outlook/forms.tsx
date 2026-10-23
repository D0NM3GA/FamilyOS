"use client";

import { useActionState } from "react";
import { btn, btnDanger, btnPrimary, field, fieldLabel } from "@/components/styles";
import type { CalendarFormState } from "./actions";

type Action = (prev: CalendarFormState, formData: FormData) => Promise<CalendarFormState>;

function Result({ state }: { state: CalendarFormState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.notice) return <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.notice}</p>;
  return null;
}

/** Asks Microsoft for calendar write access (actions.ts grantCalendarAccess explains how). */
export function GrantAccessButton({ action }: { action: () => Promise<CalendarFormState> }) {
  const [state, formAction, pending] = useActionState<CalendarFormState>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Opening Microsoft…" : "Grant calendar access"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** `defaultName` is the household's name, a sensible first guess for the calendar's. */
export function ConnectForm({ action, defaultName }: { action: Action; defaultName: string }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className={`${fieldLabel} block`}>Calendar name in Outlook</span>
        <input
          name="name"
          defaultValue={defaultName}
          required
          className={`${field} mt-1 w-full max-w-xs`}
        />
      </label>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Connecting…" : "Connect"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function SyncNowForm({ action }: { action: () => Promise<CalendarFormState> }) {
  const [state, formAction, pending] = useActionState<CalendarFormState>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Result state={state} />
    </form>
  );
}

type Options = {
  includeDates: boolean;
  includeVehicles: boolean;
  includeChores: boolean;
  includeMeds: boolean;
  includeSchoolTasks: boolean;
  includeAssignments: boolean;
};

function Box({ name, label, hint, checked }: { name: keyof Options; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 items-start gap-2 text-sm text-foreground sm:min-h-0">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function OptionsForm({ action, options }: { action: Action; options: Options }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <Box name="includeDates" checked={options.includeDates} label="Birthdays, anniversaries and other important dates" hint="Every year, all day." />
      <Box name="includeVehicles" checked={options.includeVehicles} label="Vehicle maintenance due dates" hint="Items tracked by months. Mileage-only items have no date to show." />
      <Box name="includeChores" checked={options.includeChores} label="Chores, next two weeks" hint="With who's doing each one." />
      <Box name="includeSchoolTasks" checked={options.includeSchoolTasks} label="School forms & to-dos" hint="Permission slips, fees and supplies, on the day they're due." />
      <Box name="includeAssignments" checked={options.includeAssignments} label="Homework due dates" hint="Can get busy. Grades are never included." />
      <Box
        name="includeMeds"
        checked={options.includeMeds}
        label="Med doses, next two weeks"
        hint="Anyone the calendar is shared with will see who takes what. Leave off unless that's fine."
      />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function DisconnectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-9">
        <input type="checkbox" name="confirm" />
        Delete the calendar and its events from Outlook
      </label>
      <button type="submit" disabled={pending} className={btnDanger}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** For admins other than the owner: stop using a calendar its owner can no longer manage. */
export function ForgetForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <label className="flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-9">
        <input type="checkbox" name="confirm" />
        Stop the app updating this calendar (it stays in its owner&apos;s Outlook)
      </label>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? "Stopping…" : "Stop updating"}
      </button>
      <Result state={state} />
    </form>
  );
}
