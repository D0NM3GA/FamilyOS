import { dosesLeft } from "@/lib/meds/as-needed";

/**
 * Phase 62: about how many days a medication's stock lasts, from its schedule. Pure, so Meds'
 * "about N days left" and the running-low reminder agree. Null when it can't be told: no count,
 * no dose amount, or a schedule with no steady daily rate (monthly, once).
 */
export type SupplyInput = {
  quantityOnHand: number | null;
  doseAmount: number | null;
  frequencyType: string;
  interval: number;
  daysOfWeek: number[];
  timesOfDay: string[];
};

/** Doses a day on average, or null for a schedule without a steady rate. */
export function dosesPerDay(m: Pick<SupplyInput, "frequencyType" | "interval" | "daysOfWeek" | "timesOfDay">): number | null {
  const times = Math.max(1, m.timesOfDay.length);
  const every = Math.max(1, m.interval || 1);
  switch (m.frequencyType) {
    case "DAILY":
    case "INTERVAL_DAYS":
      return times / every;
    case "DAYS_OF_WEEK":
      return m.daysOfWeek.length > 0 ? (times * m.daysOfWeek.length) / 7 : null;
    case "WEEKLY":
      return times / (7 * every);
    default:
      return null;
  }
}

export function daysOfSupply(m: SupplyInput): number | null {
  if (m.quantityOnHand == null || m.doseAmount == null || m.doseAmount <= 0) return null;
  const rate = dosesPerDay(m);
  if (rate == null || rate <= 0) return null;
  return Math.max(0, m.quantityOnHand) / (m.doseAmount * rate);
}

/** "about 5 days left", or null when it can't be told. For Meds and Manage. */
export function daysLeftLabel(m: SupplyInput): string | null {
  // Phase 65a: an as-needed medicine has no daily rate; its supply is told in doses.
  if (m.frequencyType === "AS_NEEDED") {
    const left = dosesLeft(m.quantityOnHand, m.doseAmount);
    return left == null || left <= 0 ? null : `${left} ${left === 1 ? "dose" : "doses"} left`;
  }
  const days = daysOfSupply(m);
  if (days == null) return null;
  // An empty bottle says so with its count and the Low badge, not "less than a day".
  if (m.quantityOnHand != null && m.quantityOnHand <= 0) return null;
  const n = Math.floor(days);
  return n < 1 ? "less than a day left" : `about ${n} ${n === 1 ? "day" : "days"} left`;
}

