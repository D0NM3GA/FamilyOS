"use client";

import { useFreshAnswer, useKeptActionState } from "@/components/keep-typed";
import { SubmitButton } from "@/components/submit";
import { btn, field, fieldLabel } from "@/components/styles";
import { addCalendarEvent, type AddEventState } from "./actions";

/**
 * Phase 64b: "+ Add event" on the Calendar, for a grown-up whose Outlook lets the app add events.
 * A title, a day, a time if it has one, and who it's for. `transactionId` comes from the server
 * when the page is drawn, so a retry after a timeout doesn't add it twice.
 */
export function AddEvent({ today, members, transactionId }: { today: string; members: { id: string; name: string }[]; transactionId: string }) {
  const [state, action, , formRef] = useKeptActionState<AddEventState>(addCalendarEvent, {});
  const { fresh, onInput } = useFreshAnswer(state);
  return (
    <details className="mt-3 rounded-xl ring-1 ring-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-bold">+ Add event</summary>
      <form ref={formRef} action={action} onInput={onInput} className="flex flex-col gap-3 px-3 pb-3">
        <input type="hidden" name="transactionId" value={transactionId} />
        <p className="text-xs text-muted-foreground">It goes to the Outlook calendar this page shows. Change or delete it in Outlook.</p>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>What</span>
          <input name="title" required maxLength={200} className={field} placeholder="Dentist" />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Day</span>
            <input type="date" name="day" required defaultValue={today} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>From (optional)</span>
            <input type="time" name="start" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>To (optional)</span>
            <input type="time" name="end" className={field} />
          </label>
        </div>
        {members.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>For (optional)</span>
            <select name="who" defaultValue="" className={field}>
              <option value="">No one in particular</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {state.error && (
          <p role="alert" className="text-sm font-bold text-destructive">
            {state.error}
          </p>
        )}
        {state.ok && fresh && (
          <p role="status" className="text-sm font-bold text-foreground">
            {state.ok}
          </p>
        )}
        <SubmitButton className={btn} pendingText="Adding…">
          Add to Outlook
        </SubmitButton>
      </form>
    </details>
  );
}
