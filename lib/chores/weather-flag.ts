import type { ForecastPeriod } from "@/lib/weather";

/**
 * At or above this chance of rain, an outdoor (weatherSensitive) chore's card gets flagged.
 * NWS's own forecast vocabulary treats "likely" as 60-70%+ and "chance" as 30-50% — 50 is a
 * defensible line between "probably fine" and "probably not," named here so it isn't a
 * magic number buried in a comparison.
 */
const RAIN_THRESHOLD_PERCENT = 50;

/** `dueDate` follows this codebase's local-calendar-day convention (lib/tasks/schedule.ts) —
 * a plain `getFullYear`/`getMonth`/`getDate` read, NOT `toISOString()`, which would convert
 * through UTC and could shift the date by one depending on the server process's own
 * timezone offset relative to the household's. Matches the date portion NWS's own
 * `startTime` already carries in ITS location's offset (see lib/weather.ts). */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A short flag string ("Rain likely · 80%") for a weather-sensitive chore due on `dueDate`,
 * or null when there's nothing to say — no forecast data, the date falls outside the
 * forecast's own window (NWS covers 7 days as 14 day/night periods; a 14-day chores board
 * horizon reaches further than that on purpose, so "no data" for a far-out date is expected,
 * not a bug), no daytime period for that date (e.g. only "Tonight" exists for today, already
 * past this evening), or the chance of rain is below the threshold.
 *
 * Pure — no fetch, no Date.now() — so it's testable independent of lib/weather.ts's client
 * and independent of "today." Flag-only, by design: this never reschedules or hides the
 * chore, it just adds a hint to the card.
 */
export function weatherFlagFor(dueDate: Date, forecast: ForecastPeriod[] | null): string | null {
  if (!forecast) return null;

  const dateStr = localDateString(dueDate);
  const period = forecast.find((p) => p.date === dateStr && p.isDaytime);
  if (!period) return null;

  const pop = period.probabilityOfPrecipitation;
  if (pop == null || pop < RAIN_THRESHOLD_PERCENT) return null;

  return `${period.shortForecast} · ${pop}%`;
}
