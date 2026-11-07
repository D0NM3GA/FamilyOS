/**
 * Phase 62b: about how many miles a day a car is driven, from its odometer readings (fill-ups,
 * services, the car's own current mileage). Pure. Uses the last 90 days; needs at least two
 * readings 14 or more days apart, and miles that went up, or there's no estimate (null).
 */
export type Reading = { at: Date; mileage: number };

export const MILEAGE_WINDOW_DAYS = 90;
export const MIN_SPAN_DAYS = 14;
/** More than this a day, every day, is a typo, not driving. */
export const MAX_MILES_PER_DAY = 1000;
const DAY = 86_400_000;

export function milesPerDay(readings: Reading[], now: Date = new Date()): number | null {
  const since = now.getTime() - MILEAGE_WINDOW_DAYS * DAY;
  const recent = readings.filter((r) => r.at.getTime() >= since && r.at.getTime() <= now.getTime() && Number.isFinite(r.mileage) && r.mileage > 0);
  if (recent.length < 2) return null;
  recent.sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = recent[0];
  const last = recent[recent.length - 1];
  const days = (last.at.getTime() - first.at.getTime()) / DAY;
  const miles = last.mileage - first.mileage;
  if (days < MIN_SPAN_DAYS || miles <= 0) return null;
  // A mistyped odometer (an extra digit) would claim thousands of miles a day: no estimate then.
  if (miles / days > MAX_MILES_PER_DAY) return null;
  return miles / days;
}

/** Days until `milesRemaining` at this rate, rounded up; null without an estimate. */
export function daysUntilMiles(milesRemaining: number, perDay: number | null): number | null {
  if (perDay == null || perDay <= 0) return null;
  return Math.max(0, Math.ceil(milesRemaining / perDay));
}
