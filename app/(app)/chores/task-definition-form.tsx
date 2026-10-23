"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { btn, btnPrimary, chip, field, fieldLabel } from "@/components/styles";
import type { TaskFormState } from "./actions";
import { RewardWord } from "@/components/family-look";

const FREQUENCIES = [
  { value: "ONCE", label: "Once" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "INTERVAL_DAYS", label: "Every N days" },
  { value: "DAYS_OF_WEEK", label: "Specific days of the week" },
];

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

/** A chip wrapping a checkbox or radio: the whole pill is the tap target, lit while checked. */
const checkChip = `${chip} cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-sun has-[:checked]:text-ink`;
const checkInChip = "size-4 shrink-0 accent-ink";

type Action = (prevState: TaskFormState, formData: FormData) => Promise<TaskFormState>;

type Member = { id: string; firstName: string; lastName: string | null };

type Defaults = {
  title?: string;
  notes?: string | null;
  frequencyType?: string;
  interval?: number | null;
  daysOfWeek?: number[];
  startDate?: Date;
  points?: number;
  assignmentStrategy?: string;
  assigneeIds?: string[];
  weatherSensitive?: boolean;
};

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function TaskDefinitionForm({
  action,
  defaults,
  members,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  defaults?: Defaults;
  members: Member[];
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<TaskFormState, FormData>(action, {});
  const [frequency, setFrequency] = useState(defaults?.frequencyType ?? "DAILY");
  const [strategy, setStrategy] = useState(defaults?.assignmentStrategy ?? "FIXED");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(defaults?.assigneeIds ?? []);
  const weatherHintId = useId();

  function toggleAssignee(id: string) {
    if (strategy === "FIXED") {
      setSelectedAssignees([id]);
    } else {
      setSelectedAssignees((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    }
  }

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <Field label="Title" name="title" defaultValue={defaults?.title} required />

      <label className="block">
        <span className={`${fieldLabel} block`}>Notes</span>
        <textarea
          name="notes"
          defaultValue={defaults?.notes ?? ""}
          rows={2}
          className={`${field} mt-1 w-full`}
        />
      </label>

      <label className="block">
        <span className={`${fieldLabel} block`}>Repeats</span>
        <select
          name="frequencyType"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className={`${field} mt-1 w-full`}
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      {(frequency === "WEEKLY" || frequency === "MONTHLY" || frequency === "INTERVAL_DAYS") && (
        <Field
          label={
            frequency === "WEEKLY"
              ? "Every N weeks"
              : frequency === "MONTHLY"
                ? "Every N months"
                : "Every N days"
          }
          name="interval"
          type="number"
          defaultValue={String(defaults?.interval ?? 1)}
        />
      )}

      {frequency === "DAYS_OF_WEEK" && (
        <fieldset>
          <legend className={fieldLabel}>On these days</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map((w) => (
              <label key={w.value} className={checkChip}>
                <input
                  type="checkbox"
                  name="daysOfWeek"
                  value={w.value}
                  defaultChecked={defaults?.daysOfWeek?.includes(w.value)}
                  className={checkInChip}
                />
                {w.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Field
        label="Starting"
        name="startDate"
        type="date"
        defaultValue={toDateInputValue(defaults?.startDate ?? new Date())}
        required
      />

      <Field label={<><RewardWord cap /> ⭐</>} name="points" type="number" defaultValue={String(defaults?.points ?? 0)} />

      <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-9">
          <input
            type="checkbox"
            name="weatherSensitive"
            defaultChecked={defaults?.weatherSensitive ?? false}
            aria-describedby={weatherHintId}
            className="size-5 shrink-0"
          />
          Weather sensitive (outdoor chore)
        </label>
        <p id={weatherHintId} className="text-xs text-muted-foreground">
          Flags this chore&apos;s card when rain is forecast for its due date — never
          reschedules it. Needs the household&apos;s location set in Settings → Household.
        </p>
      </div>

      <label className="block">
        <span className={`${fieldLabel} block`}>Assignment</span>
        <select
          name="assignmentStrategy"
          value={strategy}
          onChange={(e) => {
            const next = e.target.value;
            setStrategy(next);
            if (next === "FIXED" && selectedAssignees.length > 1) {
              setSelectedAssignees(selectedAssignees.slice(0, 1));
            }
          }}
          className={`${field} mt-1 w-full`}
        >
          <option value="FIXED">Always the same person</option>
          <option value="ROUND_ROBIN">Rotate through a group</option>
          <option value="LEAST_ASSIGNED">Whoever&apos;s done it least</option>
        </select>
      </label>

      <fieldset>
        <legend className={fieldLabel}>{strategy === "FIXED" ? "Assigned to" : "Eligible people"}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {members.map((m) => (
            <label key={m.id} className={checkChip}>
              <input
                type={strategy === "FIXED" ? "radio" : "checkbox"}
                name="assigneeIds"
                value={m.id}
                checked={selectedAssignees.includes(m.id)}
                onChange={() => toggleAssignee(m.id)}
                className={checkInChip}
              />
              {m.firstName}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
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
  label: React.ReactNode;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
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
