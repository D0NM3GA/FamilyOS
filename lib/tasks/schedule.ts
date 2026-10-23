/**
 * Pure recurrence math — no Prisma, no I/O. Dates are treated as local calendar days
 * (midnight, matching lib/people.ts's important-date logic), not UTC instants, since a
 * "due today" chore should match the family's actual wall-clock day.
 */

export type FrequencyType = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL_DAYS" | "DAYS_OF_WEEK";

export type RecurrenceRule = {
  frequencyType: FrequencyType;
  startDate: Date;
  /** WEEKLY: every N weeks. MONTHLY: every N months. INTERVAL_DAYS: every N days. */
  interval: number | null;
  /** DAYS_OF_WEEK only: 0=Sunday..6=Saturday. */
  daysOfWeek: number[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const targetMonthIndex = d.getMonth() + months;
  const firstOfTargetMonth = new Date(d.getFullYear(), targetMonthIndex, 1);
  const lastDayOfTargetMonth = new Date(
    firstOfTargetMonth.getFullYear(),
    firstOfTargetMonth.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(d.getDate(), lastDayOfTargetMonth);
  return new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth(), day);
}

/**
 * DST-immune day count between two local-midnight dates (positive if b is after a).
 * Exported for lib/vehicles/due-status.ts, which needs a "days until due" count outside
 * this module's own occurrence-generation use — callers should still pass already
 * `atMidnight`-normalized dates, same as every internal caller here does.
 */
export function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / DAY_MS);
}

function stepByDays(start: Date, target: Date, periodDays: number): Date {
  const diff = daysBetween(start, target);
  const steps = Math.max(Math.ceil(diff / periodDays), 0);
  return addDays(start, steps * periodDays);
}

function stepByMonths(start: Date, target: Date, periodMonths: number): Date {
  let steps =
    (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth());
  steps = Math.max(Math.floor(steps / periodMonths) * periodMonths, 0);

  let candidate = addMonths(start, steps);
  while (candidate < target) {
    steps += periodMonths;
    candidate = addMonths(start, steps);
  }
  while (steps - periodMonths >= 0 && addMonths(start, steps - periodMonths) >= target) {
    steps -= periodMonths;
    candidate = addMonths(start, steps);
  }
  return candidate;
}

/**
 * The first occurrence on or after `from`, or null if the series has no more
 * occurrences on/after that date (only possible for ONCE).
 */
export function firstOccurrenceOnOrAfter(rule: RecurrenceRule, from: Date): Date | null {
  const start = atMidnight(rule.startDate);
  const fromMid = atMidnight(from);

  if (rule.frequencyType === "ONCE") {
    return start >= fromMid ? start : null;
  }

  const target = fromMid < start ? start : fromMid;

  switch (rule.frequencyType) {
    case "DAILY":
      return stepByDays(start, target, 1);
    case "INTERVAL_DAYS":
      return stepByDays(start, target, Math.max(rule.interval ?? 1, 1));
    case "WEEKLY":
      return stepByDays(start, target, Math.max(rule.interval ?? 1, 1) * 7);
    case "MONTHLY":
      return stepByMonths(start, target, Math.max(rule.interval ?? 1, 1));
    case "DAYS_OF_WEEK": {
      if (!rule.daysOfWeek || rule.daysOfWeek.length === 0) return null;
      for (let i = 0; i < 7; i++) {
        const candidate = addDays(target, i);
        if (rule.daysOfWeek.includes(candidate.getDay())) return candidate;
      }
      return null; // unreachable — every week has at least one matching day
    }
  }
}

/** All occurrences in [from, to], stepping forward via firstOccurrenceOnOrAfter. */
export function generateOccurrences(
  rule: RecurrenceRule,
  opts: { from: Date; to: Date; limit?: number },
): Date[] {
  const results: Date[] = [];
  let cursor = opts.from;
  const limit = opts.limit ?? 730;

  for (let i = 0; i < limit; i++) {
    const next = firstOccurrenceOnOrAfter(rule, cursor);
    if (!next || next > opts.to) break;
    results.push(next);
    cursor = addDays(next, 1);
  }

  return results;
}

/**
 * Expands each calendar-day occurrence into one Date per "HH:mm" entry in `timesOfDay`
 * (same calendar day, hours/minutes set on it) — for domains needing multiple
 * occurrences/day (meds dosing). Empty `timesOfDay` returns `dayOccurrences` unchanged,
 * so a definition that never sets it (all of Chores, today) behaves exactly as before —
 * one midnight instance/day. Runs after generateOccurrences' own day-level horizon
 * filtering, so a dose later in the day than the horizon's time-of-day still generates;
 * do not re-filter the expanded result against the horizon a second time, or a
 * midnight-horizon caller (e.g. Home's `horizonDays: 0`) would silently drop every dose
 * later than midnight today.
 */
export function expandTimesOfDay(dayOccurrences: Date[], timesOfDay: string[]): Date[] {
  if (timesOfDay.length === 0) return dayOccurrences;

  const results: Date[] = [];
  for (const day of dayOccurrences) {
    for (const time of timesOfDay) {
      const [hh, mm] = time.split(":").map(Number);
      results.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm));
    }
  }
  return results;
}
