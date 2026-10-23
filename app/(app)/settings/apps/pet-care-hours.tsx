"use client";

import { useActionState } from "react";
import type { CareHours } from "@/lib/pet/care-hours";
import { btnPrimary, field, fieldLabel } from "@/components/styles";
import { SubmitButton } from "@/components/submit";
import { setPetCareHours, type CareHoursState } from "./actions";

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function hourName(hour: number): string {
  if (hour === 0 || hour === 24) return "midnight";
  if (hour === 12) return "noon";
  return `${hour % 12}${hour < 12 ? "am" : "pm"}`;
}

function Window({ day, index, value }: { day: "weekday" | "weekend"; index: number; value?: { start: number; end: number } }) {
  const name = `${day}-${index}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`${name}-from`}>
        {day === "weekday" ? "Weekdays" : "Weekends"}, time {index + 1}: from
      </label>
      <select id={`${name}-from`} name={`${name}-from`} defaultValue={value ? value.start / 60 : ""} className={field}>
        <option value="">Off</option>
        {HOURS.slice(0, 24).map((hour) => (
          <option key={hour} value={hour}>
            {hourName(hour)}
          </option>
        ))}
      </select>
      <span aria-hidden="true">to</span>
      <label className="sr-only" htmlFor={`${name}-to`}>
        to
      </label>
      <select id={`${name}-to`} name={`${name}-to`} defaultValue={value ? value.end / 60 : ""} className={field}>
        <option value="">Off</option>
        {HOURS.slice(1).map((hour) => (
          <option key={hour} value={hour}>
            {hourName(hour)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Phase 47: when the pets are awake. Their clock only runs in these hours, so time at school
 * or asleep can't make one hungry or sick. Up to two stretches a day, weekdays and weekends.
 */
export function PetCareHours({ careHours }: { careHours: CareHours }) {
  const [state, save] = useActionState<CareHoursState, FormData>(setPetCareHours, {});
  return (
    <form action={save} className="mt-8 space-y-4">
      <div>
        <h2 className="text-xl font-extrabold">Pet care hours</h2>
        <p className="text-sm text-muted-foreground">
          Pets are only awake in these hours, so they never get hungry or poorly while everyone&apos;s at school or asleep.
        </p>
      </div>
      {(["weekday", "weekend"] as const).map((day) => (
        <fieldset key={day} className="space-y-2">
          <legend className={fieldLabel}>{day === "weekday" ? "Weekdays" : "Weekends"}</legend>
          <Window day={day} index={0} value={careHours[day][0]} />
          <Window day={day} index={1} value={careHours[day][1]} />
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <SubmitButton className={btnPrimary}>Save care hours</SubmitButton>
        {state.saved && (
          <p className="text-sm font-bold" role="status">
            Saved.
          </p>
        )}
      </div>
    </form>
  );
}
