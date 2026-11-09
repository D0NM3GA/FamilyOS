"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useKeptActionState } from "@/components/keep-typed";
import { MoreOptions } from "@/components/more-options";
import { btn, btnPrimary, chip, field, fieldLabel, formActions } from "@/components/styles";
import type { TaskFormState } from "./actions";
import { RewardWord } from "@/components/family-look";
import { useHouseholdZone } from "@/components/household-zone";
import { toISODate } from "@/lib/format";

const FREQUENCIES = [
  { value: "ONCE", label: "Once" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "INTERVAL_DAYS", label: "Every few days" },
  { value: "DAYS_OF_WEEK", label: "On certain days" },
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
  needsCheck?: boolean;
};

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
  const zone = useHouseholdZone();
  const [state, formAction, pending, formRef] = useKeptActionState<TaskFormState>(action, {});
  const [frequency, setFrequency] = useState(defaults?.frequencyType ?? "DAILY");
  const [strategy, setStrategy] = useState(defaults?.assignmentStrategy ?? "FIXED");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(defaults?.assigneeIds ?? []);
  const weatherHintId = useId();
  const checkHintId = useId();

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
    <form ref={formRef} action={formAction} className="space-y-4">
      <Field label="Title" name="title" defaultValue={defaults?.title} required autoFocus={!defaults} />

      <label className="block">
        <span className={`${fieldLabel} block`}>Who does it</span>
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
          <option value="ROUND_ROBIN">Take turns</option>
          <option value="LEAST_ASSIGNED">Whoever&apos;s done it least</option>
        </select>
      </label>

      <fieldset>
        <legend className={fieldLabel}>{strategy === "FIXED" ? "Who" : "Who can do it"}</legend>
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
              ? "Every how many weeks?"
              : frequency === "MONTHLY"
                ? "Every how many months?"
                : "Every how many days?"
          }
          name="interval"
          type="number"
          min={1}
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

      <MoreOptions open={Boolean(defaults) || Boolean(state.error)} summary="Notes, start date, rewards, outdoor">
        <label className="block">
          <span className={`${fieldLabel} block`}>Notes</span>
          <textarea
            name="notes"
            defaultValue={defaults?.notes ?? ""}
            rows={2}
            className={`${field} mt-1 w-full`}
          />
        </label>
  
        <Field
          label="Starting"
          name="startDate"
          type="date"
          defaultValue={toISODate(defaults?.startDate ?? new Date(), zone)}
        />
  
        <Field label={<><RewardWord cap /> ⭐</>} name="points" type="number" min={0} defaultValue={String(defaults?.points ?? 0)} />
  
        <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-9">
            <input
              type="checkbox"
              name="weatherSensitive"
              defaultChecked={defaults?.weatherSensitive ?? false}
              aria-describedby={weatherHintId}
              className="size-5 shrink-0"
            />
            Outdoor chore
          </label>
          <p id={weatherHintId} className="text-xs text-muted-foreground">
            Warns on its card when rain is forecast. It needs where home is, in Settings → Household.
          </p>
        </div>

        <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-9">
            <input type="checkbox" name="needsCheck" defaultChecked={defaults?.needsCheck ?? false} aria-describedby={checkHintId} className="size-5 shrink-0" />
            A grown-up checks it
          </label>
          <p id={checkHintId} className="text-xs text-muted-foreground">
            When a kid ticks it, it waits for a grown-up&apos;s OK before the <RewardWord /> are paid.
          </p>
        </div>
      </MoreOptions>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

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
  autoFocus,
  min,
}: {
  label: React.ReactNode;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  autoFocus?: boolean;
  min?: number;
}) {
  return (
    <label className="block">
      <span className={`${fieldLabel} block`}>{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        autoFocus={autoFocus}
        min={min}
        // The number pad on a phone, not the punctuation keyboard.
        inputMode={type === "number" ? "numeric" : undefined}
        className={`${field} mt-1 w-full`}
      />
    </label>
  );
}
