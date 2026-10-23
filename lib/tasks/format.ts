import { formatTimeOfDay } from "@/lib/format";

type RecurrenceLike = {
  frequencyType: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL_DAYS" | "DAYS_OF_WEEK";
  interval: number | null;
  daysOfWeek: number[];
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Human-readable recurrence ("Every 2 weeks", "Mon, Wed, Fri", "Every 3 days"). Kernel,
 * shared by the Chores and Meds manage pages and their print views. Before Phase 13 each
 * manage page had its own FREQUENCY_LABEL copy that only said "Weekly"/"Specific days".
 */
export function describeRecurrence(rule: RecurrenceLike): string {
  const n = Math.max(rule.interval ?? 1, 1);
  switch (rule.frequencyType) {
    case "ONCE":
      return "Once";
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return n === 1 ? "Weekly" : `Every ${n} weeks`;
    case "MONTHLY":
      return n === 1 ? "Monthly" : `Every ${n} months`;
    case "INTERVAL_DAYS":
      return n === 1 ? "Daily" : `Every ${n} days`;
    case "DAYS_OF_WEEK": {
      const days = [...new Set(rule.daysOfWeek)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
      if (days.length === 0) return "Specific days";
      if (days.length === 7) return "Daily";
      return days.map((d) => DAY_NAMES[d]).join(", ");
    }
  }
}

/** "08:00" -> "8:00 AM" — matches the 12h time the boards show. Server-side only. */
export function formatHHmm(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  return formatTimeOfDay(new Date(2000, 0, 1, hh, mm));
}
