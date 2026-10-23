"use client";

import Link from "next/link";
import { useActionState, useState, useEffect, useId, useRef } from "react";
import { btn, btnPrimary, chip, field, fieldLabel } from "@/components/styles";
import { searchMedicationNames } from "./actions";
import type { TaskFormState } from "./actions";
import { stripDosageForm } from "@/lib/meds/rxterms";
import { RewardWord } from "@/components/family-look";
import { useHouseholdZone } from "@/components/household-zone";
import { toISODate } from "@/lib/format";

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
type Contact = { id: string; firstName: string; lastName: string | null };

type Defaults = {
  title?: string;
  notes?: string | null;
  frequencyType?: string;
  interval?: number | null;
  daysOfWeek?: number[];
  startDate?: Date;
  points?: number;
  timesOfDay?: string[];
  assigneeIds?: string[];
  quantityOnHand?: number | null;
  doseAmount?: number | null;
  refillThresholdQuantity?: number | null;
  prescriberId?: string | null;
  pharmacyId?: string | null;
};

export function TaskDefinitionForm({
  action,
  defaults,
  members,
  contacts,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  defaults?: Defaults;
  members: Member[];
  contacts: Contact[];
  submitLabel: string;
  cancelHref: string;
}) {
  const zone = useHouseholdZone();
  const [state, formAction, pending] = useActionState<TaskFormState, FormData>(action, {});
  const [frequency, setFrequency] = useState(defaults?.frequencyType ?? "DAILY");
  const [assigneeId, setAssigneeId] = useState<string | undefined>(defaults?.assigneeIds?.[0]);
  const [times, setTimes] = useState<string[]>(
    defaults?.timesOfDay && defaults.timesOfDay.length > 0 ? defaults.timesOfDay : ["08:00"],
  );
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Distinguishes "the user typed" from title changing for any other reason (the edit
  // page's initial `defaults.title`, or a suggestion being picked — see selectSuggestion)
  // — without this, the effect below fires after both and reopens a dropdown nobody asked
  // to see, right on page load or right after a selection was just made.
  const typedRef = useRef(false);
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLUListElement>(null);
  const stockHintId = useId();

  useEffect(() => {
    if (!typedRef.current) return;
    typedRef.current = false;

    if (title.trim().length < 2) return; // handled synchronously in handleTitleChange instead

    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await searchMedicationNames(title);
      if (cancelled) return; // a newer keystroke's request already landed or is in flight
      setNameSuggestions(results);
      setSuggestionsOpen(results.length > 0);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title]);

  function handleTitleChange(value: string) {
    typedRef.current = true;
    setTitle(value);
    if (value.trim().length < 2) {
      setNameSuggestions([]);
      setSuggestionsOpen(false);
    }
  }

  function selectSuggestion(name: string) {
    setTitle(stripDosageForm(name));
    setNameSuggestions([]);
    setSuggestionsOpen(false);
  }

  // Keyboard: ↓ from the box into the list, ↑/↓ within it, Escape back to the box. The list
  // closes when focus leaves the box and the list together, not on the box's own blur (which
  // closed it before a Tab or ↓ could reach a suggestion).
  function moveFocus(e: React.KeyboardEvent, from: number) {
    const items = suggestionsRef.current?.querySelectorAll("button");
    if (e.key === "Escape") {
      e.preventDefault();
      setSuggestionsOpen(false);
      titleRef.current?.focus();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items?.length) {
      e.preventDefault();
      const next = from + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) titleRef.current?.focus();
      else items[Math.min(next, items.length - 1)].focus();
    }
  }

  function updateTime(index: number, value: string) {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function addTime() {
    setTimes((prev) => [...prev, ""]);
  }

  function removeTime(index: number) {
    setTimes((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSuggestionsOpen(false);
        }}
      >
        <label htmlFor={titleId} className={`${fieldLabel} block`}>
          Medication
        </label>
        <input
          id={titleId}
          ref={titleRef}
          type="text"
          name="title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onFocus={() => setSuggestionsOpen(nameSuggestions.length > 0)}
          onKeyDown={(e) => {
            if (suggestionsOpen) moveFocus(e, -1);
          }}
          required
          autoComplete="off"
          className={`${field} mt-1 w-full`}
        />
        {suggestionsOpen && (
          <ul
            id={`${titleId}-suggestions`}
            ref={suggestionsRef}
            aria-label="Suggested medication names"
            className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl bg-card py-1 shadow-lg ring-1 ring-border"
          >
            {nameSuggestions.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    selectSuggestion(s);
                    titleRef.current?.focus();
                  }}
                  onKeyDown={(e) => moveFocus(e, i)}
                  className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-muted sm:min-h-9"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Suggestions from the U.S. National Library of Medicine (NLM) — NLM is not
          responsible for and does not endorse this product.
          {title.trim() && (
            <>
              {" "}
              ·{" "}
              <a
                href={`https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(title.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-text hover:underline"
              >
                Look up on DailyMed
              </a>
            </>
          )}
        </p>
      </div>

      <label className="block">
        <span className={`${fieldLabel} block`}>Dosage / instructions</span>
        <textarea
          name="notes"
          defaultValue={defaults?.notes ?? ""}
          rows={2}
          placeholder="e.g. 1 tablet with food"
          className={`${field} mt-1 w-full`}
        />
      </label>

      <fieldset>
        <legend className={fieldLabel}>Times of day</legend>
        <div className="mt-1 space-y-2">
          {times.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                name="timesOfDay"
                value={t}
                onChange={(e) => updateTime(i, e.target.value)}
                required
                aria-label={times.length > 1 ? `Time ${i + 1}` : "Time"}
                className={field}
              />
              {times.length > 1 && (
                <button type="button" onClick={() => removeTime(i)} className={btn}>
                  Remove<span className="sr-only"> time {i + 1}</span>
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addTime} className={btn}>
            + Add another time
          </button>
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
        defaultValue={toISODate(defaults?.startDate ?? new Date(), zone)}
        required
      />

      <Field label={<><RewardWord cap /> ⭐</>} name="points" type="number" defaultValue={String(defaults?.points ?? 0)} />

      <fieldset>
        <legend className={fieldLabel}>For</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {members.map((m) => (
            <label key={m.id} className={checkChip}>
              <input
                type="radio"
                name="assigneeIds"
                value={m.id}
                checked={assigneeId === m.id}
                onChange={() => setAssigneeId(m.id)}
                required
                className={checkInChip}
              />
              {m.firstName}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset aria-describedby={stockHintId} className="space-y-3 rounded-xl border-2 border-input p-3">
        <legend className={`${fieldLabel} px-1`}>Stock tracking (optional)</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="On hand"
            name="quantityOnHand"
            type="number"
            step="any"
            defaultValue={defaults?.quantityOnHand != null ? String(defaults.quantityOnHand) : ""}
          />
          <Field
            label="Per dose"
            name="doseAmount"
            type="number"
            step="any"
            defaultValue={defaults?.doseAmount != null ? String(defaults.doseAmount) : ""}
          />
          <Field
            label="Refill at"
            name="refillThresholdQuantity"
            type="number"
            step="any"
            defaultValue={
              defaults?.refillThresholdQuantity != null ? String(defaults.refillThresholdQuantity) : ""
            }
          />
        </div>
        <p id={stockHintId} className="text-xs text-muted-foreground">
          Fill in &ldquo;On hand&rdquo; and &ldquo;Per dose&rdquo; to have completing a dose
          count down automatically. &ldquo;Refill at&rdquo; adds it to the grocery list once
          the count drops that low.
        </p>
      </fieldset>

      {/* Stacked on a phone: half-width selects clip a prescriber's full name. */}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
        <ContactSelect label="Prescriber" name="prescriberId" defaultValue={defaults?.prescriberId} contacts={contacts} />
        <ContactSelect label="Pharmacy" name="pharmacyId" defaultValue={defaults?.pharmacyId} contacts={contacts} />
      </div>

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

function ContactSelect({
  label,
  name,
  defaultValue,
  contacts,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  contacts: Contact[];
}) {
  return (
    <label className="block min-w-0">
      <span className={`${fieldLabel} block`}>{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className={`${field} mt-1 w-full`}>
        <option value="">None</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.firstName}
            {c.lastName ? ` ${c.lastName}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  step,
}: {
  label: React.ReactNode;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={`${fieldLabel} block`}>{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        step={step}
        className={`${field} mt-1 w-full`}
      />
    </label>
  );
}
