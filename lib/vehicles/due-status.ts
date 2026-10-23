/**
 * Pure due/overdue math for vehicle maintenance items — no Prisma, no I/O. Mirrors
 * lib/tasks/schedule.ts's style (pure functions, local-midnight dates), but this isn't
 * built on that module's recurrence engine: mileage isn't knowable in advance the way a
 * calendar date is, so there's no equivalent of `generateOccurrences` here — just "given
 * what we know right now, is this overdue?"
 */
import { addMonths, atMidnight, daysBetween } from "@/lib/tasks/schedule";

export type DueStatus = "OVERDUE" | "UPCOMING" | "OK";

export type MaintenanceItemLike = {
  intervalMiles: number | null;
  intervalMonths: number | null;
  lastDoneMileage: number | null;
  lastDoneAt: Date | null;
};

export type DueResult = {
  status: DueStatus;
  /** Odometer reading this item is next due at, or null if the mileage axis isn't tracked yet. */
  dueByMileage: number | null;
  /** Calendar date this item is next due by, or null if the date axis isn't tracked yet. */
  dueByDate: Date | null;
  /** Miles until dueByMileage (negative if overdue), or null if that axis isn't tracked. */
  milesRemaining: number | null;
  /** Days until dueByDate (negative if overdue), or null if that axis isn't tracked. */
  daysRemaining: number | null;
};

/** Within this many miles of due counts as "coming up soon" rather than "OK". */
export const UPCOMING_MILES_BAND = 500;
/** Within this many days of due counts as "coming up soon" rather than "OK". */
export const UPCOMING_DAYS_BAND = 30;

const NEVER_DONE: DueResult = {
  status: "OVERDUE",
  dueByMileage: null,
  dueByDate: null,
  milesRemaining: null,
  daysRemaining: null,
};

/**
 * `currentMileage` is the vehicle's own odometer reading; `today` is a plain `Date` (any
 * time-of-day — normalized internally). Each axis (mileage, date) contributes only when
 * both its interval AND a last-done baseline are present, so an item tracked by mileage
 * alone doesn't get penalized for having no last-done date, and vice versa. An item with
 * neither axis's baseline set has never been serviced and is due immediately.
 */
export function computeDueStatus(
  item: MaintenanceItemLike,
  currentMileage: number,
  today: Date,
): DueResult {
  if (item.lastDoneMileage == null && item.lastDoneAt == null) {
    return NEVER_DONE;
  }

  const dueByMileage =
    item.intervalMiles != null && item.lastDoneMileage != null
      ? item.lastDoneMileage + item.intervalMiles
      : null;
  const dueByDate =
    item.intervalMonths != null && item.lastDoneAt != null
      ? addMonths(item.lastDoneAt, item.intervalMonths)
      : null;

  const milesRemaining = dueByMileage != null ? dueByMileage - currentMileage : null;
  // addMonths returns local midnight, so lastDoneAt's own time-of-day never survives into
  // dueByDate — daysBetween compares whole calendar days either way.
  const daysRemaining = dueByDate != null ? daysBetween(atMidnight(today), atMidnight(dueByDate)) : null;

  const overdue =
    (milesRemaining != null && milesRemaining <= 0) || (daysRemaining != null && daysRemaining <= 0);
  const upcoming =
    !overdue &&
    ((milesRemaining != null && milesRemaining <= UPCOMING_MILES_BAND) ||
      (daysRemaining != null && daysRemaining <= UPCOMING_DAYS_BAND));

  return {
    status: overdue ? "OVERDUE" : upcoming ? "UPCOMING" : "OK",
    dueByMileage,
    dueByDate,
    milesRemaining,
    daysRemaining,
  };
}
