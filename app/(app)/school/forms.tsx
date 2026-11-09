"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { useEffect, useRef, useState } from "react";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import type { SchoolFormState } from "./actions";
import { ASSIGNMENT_KINDS, ASSIGNMENT_KIND_LABEL, type AssignmentKindValue } from "@/lib/school/form";

type Action = (prev: SchoolFormState, fd: FormData) => Promise<SchoolFormState>;

const box = `mt-1 w-full ${field}`;

/** A label over its box; wrapping the box is what names it for a screen reader. */
function Labeled({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function Result({ state }: { state: SchoolFormState }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  if (state.notice) return <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.notice}</p>;
  return null;
}

type ProfileDefaults = {
  schoolName?: string;
  grade?: string | null;
  schoolYear?: string | null;
  transportNotes?: string | null;
  lunchNotes?: string | null;
  scheduleNotes?: string | null;
  notes?: string | null;
};

export function ProfileForm({ action, defaults }: { action: Action; defaults?: ProfileDefaults }) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  const d = defaults ?? {};
  return (
    <form ref={keptForm} action={formAction} className="max-w-lg space-y-3">
      <Labeled label="School">
        <input name="schoolName" required defaultValue={d.schoolName} placeholder="e.g. Lincoln Elementary" className={box} />
      </Labeled>
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Grade">
          <input name="grade" defaultValue={d.grade ?? ""} placeholder="3rd" className={box} />
        </Labeled>
        <Labeled label="School year">
          <input name="schoolYear" defaultValue={d.schoolYear ?? ""} placeholder="2026-27" className={box} />
        </Labeled>
      </div>
      <Labeled label="Getting there and back">
        <input name="transportNotes" defaultValue={d.transportNotes ?? ""} placeholder="Bus 14, stop at Oak & 3rd, 7:42am" className={box} />
      </Labeled>
      <Labeled label="Lunch">
        <input name="lunchNotes" defaultValue={d.lunchNotes ?? ""} placeholder="Account #, allergies the cafeteria knows about" className={box} />
      </Labeled>
      <Labeled label="Schedule">
        <textarea name="scheduleNotes" rows={3} defaultValue={d.scheduleNotes ?? ""} placeholder="PE on Tuesdays (sneakers!), library Thursday" className={box} />
      </Labeled>
      <Labeled label="Notes">
        <textarea name="notes" rows={2} defaultValue={d.notes ?? ""} className={box} />
      </Labeled>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function ContactForm({ action, contacts }: { action: Action; contacts: { id: string; name: string }[] }) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  const [existing, setExisting] = useState("");
  return (
    <form ref={keptForm} action={formAction} className="max-w-lg space-y-3">
      <Labeled label="Role">
        <input name="role" required placeholder="Homeroom teacher, Math, Front office" className={box} />
      </Labeled>
      <Labeled label="Someone already in People">
        <select name="existingPersonId" value={existing} onChange={(e) => setExisting(e.target.value)} className={box}>
          <option value="">No, add someone new</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Labeled>
      {!existing && (
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="First name">
            <input name="firstName" className={box} />
          </Labeled>
          <Labeled label="Last name">
            <input name="lastName" className={box} />
          </Labeled>
          <Labeled label="Email">
            <input name="email" type="email" className={box} />
          </Labeled>
          <Labeled label="Phone">
            <input name="phone" type="tel" className={box} />
          </Labeled>
        </div>
      )}
      <button type="submit" disabled={pending} className={btn}>
        {pending ? "Adding…" : "Add contact"}
      </button>
      <Result state={state} />
    </form>
  );
}

type TaskDefaults = {
  title: string;
  kind: string;
  dueDate: string;
  amount: string;
  kidPersonId: string;
  ownerPersonId: string;
  notes: string;
};

/** Calls `onSaved` once each time the action reports it saved (Phase 59.2a: an edit in a row closes itself). */
function useOnSaved(state: SchoolFormState, onSaved?: () => void) {
  const seen = useRef(state);
  useEffect(() => {
    if (state !== seen.current && state.notice) onSaved?.();
    seen.current = state;
  }, [state, onSaved]);
}

/** Add (collapsed until opened), or, with `defaults` and `onClose`, a form's edit in its row (Phase 59.2a). */
export function TaskForm({
  action,
  kids,
  adults,
  defaultKidId,
  defaults,
  onClose,
}: {
  action: Action;
  kids: { id: string; name: string }[];
  adults: { id: string; name: string }[];
  defaultKidId?: string;
  defaults?: TaskDefaults;
  onClose?: () => void;
}) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  const [open, setOpen] = useState(Boolean(onClose));
  useOnSaved(state, onClose);
  const d = defaults;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        + Form or to-do
      </button>
    );
  }
  return (
    <form ref={keptForm} action={formAction} className="space-y-3 rounded-xl bg-muted p-3">
      <Labeled label="What">
        <input name="title" required defaultValue={d?.title} placeholder="Field trip permission slip" className={box} />
      </Labeled>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Labeled label="Kind">
          <select name="kind" defaultValue={d?.kind ?? "FORM"} className={box}>
            <option value="FORM">Form</option>
            <option value="FEE">Fee</option>
            <option value="SUPPLIES">Supplies</option>
            <option value="OTHER">Other</option>
          </select>
        </Labeled>
        <Labeled label="Due">
          <input name="dueDate" type="date" defaultValue={d?.dueDate} className={box} />
        </Labeled>
        <Labeled label="Amount">
          <input name="amount" inputMode="decimal" defaultValue={d?.amount} placeholder="$0.00" className={box} />
        </Labeled>
        <Labeled label="For">
          <select name="kidPersonId" defaultValue={d?.kidPersonId ?? defaultKidId ?? ""} className={box}>
            <option value="">Everyone</option>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <Labeled label="Notes">
        <input name="notes" defaultValue={d?.notes} placeholder="Optional" className={box} />
      </Labeled>
      <Labeled label="Who's handling it">
        <select name="ownerPersonId" defaultValue={d?.ownerPersonId ?? ""} className={box}>
          <option value="">Nobody yet</option>
          {adults.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Labeled>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {onClose ? (pending ? "Saving…" : "Save") : pending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => (onClose ? onClose() : setOpen(false))} className={btn}>
          {onClose ? "Cancel" : "Done"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

type AssignmentDefaults = {
  className?: string;
  title?: string;
  kind?: AssignmentKindValue;
  dueDate?: string;
  status?: string;
  score?: number | null;
  maxScore?: number | null;
  notes?: string | null;
};

/** Add (collapsed until opened) or edit. Kids get no score or "missing" fields. */
export function AssignmentForm({
  action,
  canGrade,
  defaults,
  startOpen = false,
  submitLabel = "Add",
}: {
  action: Action;
  canGrade: boolean;
  defaults?: AssignmentDefaults;
  startOpen?: boolean;
  submitLabel?: string;
}) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  const [open, setOpen] = useState(startOpen);
  const d = defaults ?? {};
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        + Homework or test
      </button>
    );
  }
  return (
    <form ref={keptForm} action={formAction} className="space-y-3 rounded-xl bg-muted p-3">
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Class">
          <input name="className" required defaultValue={d.className} placeholder="Math" className={box} />
        </Labeled>
        <Labeled label="Due">
          <input name="dueDate" type="date" defaultValue={d.dueDate} className={box} />
        </Labeled>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <Labeled label="What">
          <input name="title" required defaultValue={d.title} placeholder="Chapter 3 worksheet" className={box} />
        </Labeled>
        <Labeled label="Type">
          <select name="kind" defaultValue={d.kind ?? "HOMEWORK"} className={box}>
            {ASSIGNMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ASSIGNMENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <Labeled label="Notes">
        <input name="notes" defaultValue={d.notes ?? ""} placeholder="Optional" className={box} />
      </Labeled>
      {canGrade && (
        // Three across is too tight for "Missing" in a phone-width select, so Status gets its own line there.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <Labeled label="Status">
              <select name="status" defaultValue={d.status ?? "TODO"} className={box}>
                <option value="TODO">To do</option>
                <option value="DONE">Done</option>
                <option value="MISSING">Missing</option>
              </select>
            </Labeled>
          </div>
          <Labeled label="Score">
            <input name="score" inputMode="decimal" defaultValue={d.score ?? ""} className={box} />
          </Labeled>
          <Labeled label="Out of">
            <input name="maxScore" inputMode="decimal" defaultValue={d.maxScore ?? ""} className={box} />
          </Labeled>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {!startOpen && (
          <button type="button" onClick={() => setOpen(false)} className={btn}>
            Done
          </button>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

type DetailsDefaults = { title: string; className: string; kind: AssignmentKindValue; dueDate: string };

/** Phase 59.2a: an assignment's title, class, type and due date, changed in its row. */
export function AssignmentDetailsForm({ action, defaults, onClose }: { action: Action; defaults: DetailsDefaults; onClose: () => void }) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  useOnSaved(state, onClose);
  return (
    <form ref={keptForm} action={formAction} className="basis-full space-y-3 rounded-xl bg-muted p-3">
      <div className="grid grid-cols-2 gap-3">
        <Labeled label="Class">
          <input name="className" required defaultValue={defaults.className} className={box} />
        </Labeled>
        <Labeled label="Due">
          <input name="dueDate" type="date" defaultValue={defaults.dueDate} className={box} />
        </Labeled>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <Labeled label="What">
          <input name="title" required defaultValue={defaults.title} autoFocus className={box} />
        </Labeled>
        <Labeled label="Type">
          <select name="kind" defaultValue={defaults.kind} className={box}>
            {ASSIGNMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ASSIGNMENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <FormButtons pending={pending} onClose={onClose} />
      <Result state={state} />
    </form>
  );
}

/** Phase 59.2a: "Grade it", in the row. */
export function GradeForm({ action, defaults, onClose }: { action: Action; defaults: { score: string; maxScore: string }; onClose: () => void }) {
  const [state, formAction, pending, keptForm] = useKeptActionState<SchoolFormState>(action, {});
  useOnSaved(state, onClose);
  return (
    <form ref={keptForm} action={formAction} className="basis-full space-y-3 rounded-xl bg-muted p-3">
      <div className="grid max-w-xs grid-cols-2 gap-3">
        <Labeled label="Score">
          <input name="score" inputMode="decimal" defaultValue={defaults.score} autoFocus className={box} />
        </Labeled>
        <Labeled label="Out of">
          <input name="maxScore" inputMode="decimal" defaultValue={defaults.maxScore} className={box} />
        </Labeled>
      </div>
      <FormButtons pending={pending} onClose={onClose} />
      <Result state={state} />
    </form>
  );
}

function FormButtons({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onClose} className={btn}>
        Cancel
      </button>
    </div>
  );
}
