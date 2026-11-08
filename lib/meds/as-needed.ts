import { formatTimeOfDay } from "@/lib/format";

/**
 * Phase 65a: a medicine taken when needed (the owner's call: a minimum gap and a daily maximum).
 * Pure. `takenAt` is every dose taken in at least the last 24 hours, any order.
 */
export type AsNeededRules = {
  minGapHours: number | null;
  maxPerDay: number | null;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type NextDose =
  { ok: true } | { ok: false; from: Date; reason: "gap" | "max" };

export function nextAllowed(
  takenAt: Date[],
  rules: AsNeededRules,
  now: Date,
): NextDose {
  let from: Date | null = null;
  let reason: "gap" | "max" = "gap";
  if (rules.minGapHours && takenAt.length) {
    const last = Math.max(...takenAt.map((d) => d.getTime()));
    const at = last + rules.minGapHours * HOUR;
    if (at > now.getTime()) from = new Date(at);
  }
  if (rules.maxPerDay) {
    const inDay = takenAt
      .map((d) => d.getTime())
      .filter((t) => t > now.getTime() - DAY && t <= now.getTime())
      .sort((a, b) => a - b);
    if (inDay.length >= rules.maxPerDay) {
      // The dose that has to age out of the 24 hours before one more fits.
      const at = inDay[inDay.length - rules.maxPerDay] + DAY;
      if (!from || at > from.getTime()) {
        from = new Date(at);
        reason = "max";
      }
    }
  }
  return from ? { ok: false, from, reason } : { ok: true };
}

/** "3:40 PM", or "Tue 3:40 PM" when it isn't today. Server time is the household's (lib/household-zone). */
export function whenWords(at: Date, now: Date): string {
  const time = formatTimeOfDay(at);
  if (at.toDateString() === now.toDateString()) return time;
  // Past a week a weekday is ambiguous: give the date.
  const far = Math.abs(now.getTime() - at.getTime()) > 6 * 86_400_000;
  return `${at.toLocaleDateString("en-US", far ? { month: "short", day: "numeric" } : { weekday: "short" })} ${time}`;
}

/** Why a dose can't be taken yet, in words. */
export function notYetWords(
  next: Extract<NextDose, { ok: false }>,
  rules: AsNeededRules,
  now: Date,
): string {
  const when = whenWords(next.from, now);
  return next.reason === "max"
    ? `That's ${rules.maxPerDay} in 24 hours. Next from ${when}.`
    : `Too soon. Next from ${when}.`;
}

/** An as-needed medicine's supply in doses ("12 doses left"), or null when it isn't counted. */
export function dosesLeft(
  quantityOnHand: number | null,
  doseAmount: number | null,
): number | null {
  if (quantityOnHand == null || !doseAmount || doseAmount <= 0) return null;
  return Math.max(0, Math.floor(quantityOnHand / doseAmount + 1e-9));
}

export const AS_NEEDED_LOW_DOSES = 5;
