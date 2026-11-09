"use client";

import { useActionState } from "react";
import { useKeptActionState } from "@/components/keep-typed";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import type { MealFormState } from "./actions";

type Action = (prev: MealFormState, formData: FormData) => Promise<MealFormState>;

function Said({ state }: { state: MealFormState }) {
  if (state.error) return <p role="alert" className="text-sm font-semibold text-tomato">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm font-semibold">{state.ok}</p>;
  return null;
}

/** Phase 65d: the week's seven dinners in one form, each a saved meal or a note. */
export function WeekForm({
  action,
  days,
  meals,
}: {
  action: Action;
  days: { label: string; mealId: string | null; note: string | null; isToday: boolean }[];
  meals: { id: string; name: string }[];
}) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="flex flex-col gap-3">
      <ul className="ui-card divide-y-2 divide-dashed divide-ink/10 rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
        {days.map((d, i) => (
          <li key={d.label} className={`grid gap-2 p-3 sm:grid-cols-[8rem_1fr_1fr] sm:items-center ${d.isToday ? "bg-sun/15" : ""}`}>
            <span className="font-bold">
              {d.label}
              {d.isToday && <span className="ml-1 text-xs font-bold text-muted-foreground">today</span>}
            </span>
            <select name={`meal:${i}`} defaultValue={d.mealId ?? ""} aria-label={`Dinner on ${d.label}`} className={field}>
              <option value="">No saved meal</option>
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input name={`note:${i}`} defaultValue={d.note ?? ""} maxLength={120} placeholder="Or a note: Leftovers, Out…" aria-label={`Note for ${d.label}`} className={field} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={btnPrimary} pendingText="Saving…">
          Save the week
        </SubmitButton>
        <Said state={state} />
      </div>
    </form>
  );
}

/** Phase 65d: "Add what's missing to the list" for the shown week. */
export function AddWeekButton({ action }: { action: (prev: MealFormState) => Promise<MealFormState> }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-3">
      <SubmitButton className={btn} pendingText="Adding…">
        🛒 Add what&apos;s missing to the list
      </SubmitButton>
      <Said state={state} />
    </form>
  );
}

/** Phase 65d: a meal's name and ingredients, one per line. */
export function MealForm({ action, name = "", ingredients = "", submitLabel }: { action: Action; name?: string; ingredients?: string; submitLabel: string }) {
  const [state, run, , formRef] = useKeptActionState(action, {});
  return (
    <form ref={formRef} action={run} className="flex flex-col gap-2" key={state.ok && !name ? state.ok : undefined}>
      <label className="block">
        <span className={`${fieldLabel} block`}>Name</span>
        <input name="name" defaultValue={name} required maxLength={80} placeholder="e.g. Tacos" className={`${field} mt-1 w-full`} />
      </label>
      <label className="block">
        <span className={`${fieldLabel} block`}>Ingredients, one per line</span>
        <textarea name="ingredients" defaultValue={ingredients} rows={5} placeholder={"Tortillas\n2 Tomatoes\n1 Ground beef"} className={`${field} mt-1 w-full`} />
      </label>
      <p className="text-xs text-muted-foreground">A number first is how many to buy. Each one becomes a Pantry item if it isn&apos;t one already.</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={btnPrimary} pendingText="Saving…">
          {submitLabel}
        </SubmitButton>
        <Said state={state} />
      </div>
    </form>
  );
}
