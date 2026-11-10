"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { useEffect, useState, useTransition } from "react";
import { btn, btnDanger, btnPrimary, field, sectionTitle } from "@/components/styles";
import { ConfirmAction } from "@/components/submit";
import { closeOnEscape, useInlineForm, useRowEdit } from "@/components/inline-form";
import { addImportantDate, deleteImportantDate, updateImportantDate, type FormState } from "./actions";

export type DateRow = {
  id: string;
  type: "BIRTHDAY" | "ANNIVERSARY" | "OTHER";
  label: string | null;
  month: number;
  day: number;
  year: number | null;
  /** Precomputed on the server ("Oct 21 · in 12 days"), so it can't differ after hydration. */
  when: string;
};

const TYPE_LABEL = { BIRTHDAY: "Birthday", ANNIVERSARY: "Anniversary", OTHER: "Other" } as const;

/**
 * A person's birthdays and other dates, soonest first: anyone can add one, grown-ups can fix
 * or remove one (a kid shouldn't be able to delete Grandma's birthday).
 */
export function ImportantDates({ personId, dates, canEdit }: { personId: string; dates: DateRow[]; canEdit: boolean }) {
  const { open: adding, show: startAdding, close: stopAdding, opener: addButton } = useInlineForm();
  const { editing, edit, stop, editButton } = useRowEdit();

  return (
    <div className="min-w-0 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={sectionTitle}>Important dates</h2>
        {!adding && (
          <button ref={addButton} type="button" onClick={startAdding} className={btn}>
            + Add date
          </button>
        )}
      </div>
      {adding && (
        <DateForm
          action={addImportantDate.bind(null, personId)}
          onDone={stopAdding}
          submitLabel="Add"
        />
      )}
      {dates.length === 0 && !adding && <p className="mt-2 text-xs text-muted-foreground">No birthdays or dates yet.</p>}
      {dates.length > 0 && (
        <ul className="mt-2 divide-y divide-border text-sm">
          {dates.map((d) =>
            editing === d.id ? (
              <li key={d.id} className="py-2">
                <DateForm
                  action={updateImportantDate.bind(null, personId, d.id)}
                  defaults={d}
                  onDone={stop}
                  submitLabel="Save"
                  deleteQuestion={`Remove ${d.label || TYPE_LABEL[d.type].toLowerCase()}?`}
                  onDelete={() => deleteImportantDate(personId, d.id)}
                />
              </li>
            ) : (
              <li key={d.id} className="flex min-h-11 items-center justify-between gap-2 py-1">
                <span className="min-w-0 break-words text-foreground">
                  {d.label || TYPE_LABEL[d.type]}
                  {d.year && <span className="text-muted-foreground"> · {d.year}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {d.when}
                  {canEdit && (
                    <button
                      type="button"
                      ref={editButton(d.id)}
                      onClick={() => edit(d.id)}
                      aria-label={`Edit ${d.label || TYPE_LABEL[d.type].toLowerCase()}`}
                      className="min-h-11 rounded-lg px-2 text-xs font-bold underline hover:text-foreground sm:min-h-0"
                    >
                      Edit
                    </button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function DateForm({
  action,
  defaults,
  onDone,
  onDelete,
  deleteQuestion,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: DateRow;
  onDone: () => void;
  onDelete?: () => Promise<void>;
  deleteQuestion?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending, keptForm] = useKeptActionState<FormState>(action, {});
  const typed = state.values ?? {};
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Each save returns a fresh `saved`; seeing one closes the form.
  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  return (
    <form ref={keptForm} action={formAction} onKeyDown={closeOnEscape(onDone)} className="mt-2 w-full min-w-0 space-y-2 rounded-md bg-muted p-3">
      <select name="type" aria-label="Kind of date" defaultValue={typed.type ?? defaults?.type ?? "BIRTHDAY"} className={`${field} w-full min-w-0`}>
        {Object.entries(TYPE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <input name="month" type="number" inputMode="numeric" min={1} max={12} placeholder="MM" aria-label="Month" required defaultValue={typed.month ?? defaults?.month} className={`${field} w-full min-w-0`} />
        <input name="day" type="number" inputMode="numeric" min={1} max={31} placeholder="DD" aria-label="Day" required defaultValue={typed.day ?? defaults?.day} className={`${field} w-full min-w-0`} />
        <input
          name="year"
          type="number" inputMode="numeric"
          min={1900}
          max={2200}
          placeholder="YYYY"
          aria-label="Year (optional)"
          defaultValue={typed.year ?? defaults?.year ?? undefined}
          className={`${field} w-full min-w-0`}
        />
      </div>
      <input name="label" placeholder="Label (optional)" aria-label="Label (optional)" defaultValue={typed.label ?? defaults?.label ?? ""} className={`${field} w-full min-w-0`} />
      {(state.error || removeError) && <p role="alert" className="text-xs text-destructive">{state.error || removeError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onDone} className={btn}>
          Cancel
        </button>
        {onDelete && (
          <ConfirmAction
            question={deleteQuestion ?? "Remove this date?"}
            yes="Remove it"
            pending={removing}
            onConfirm={() => {
              setRemoveError(null);
              startRemove(async () => {
                try {
                  await onDelete();
                } catch {
                  setRemoveError("Couldn't delete that. Someone may have changed it already; reload to check.");
                }
              });
            }}
            className={`${btnDanger} ml-auto`}
          >
            Remove
          </ConfirmAction>
        )}
      </div>
    </form>
  );
}
