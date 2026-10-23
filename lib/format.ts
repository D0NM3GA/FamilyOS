const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today" / "3 days ago" / "in 5 days" / "Never" (for nulls) — coarse, human-facing. */
export function formatRelative(date: Date | null): string {
  if (!date) return "Never";

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / DAY_MS);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 30) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -30) return `${Math.abs(diffDays)} days ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Just the time-of-day (e.g. "8:00 AM") — for multi-dose (meds) instances where the exact
 * time, not just the day, distinguishes one card from another. Always call this
 * server-side and pass the result down as a plain string prop, never from inside a client
 * component: a client component runs once during server rendering (Node's timezone) and
 * again on hydration (the browser's), and if those differ this produces either a
 * hydration mismatch or a value that visibly changes right after page load.
 */
export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatMonthDay(month: number, day: number): string {
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/** "Sep 22, 2026" for a local date — history rows and every /print/** page. */
export function formatFullDate(d: Date): string {
  return `${formatMonthDay(d.getMonth() + 1, d.getDate())}, ${d.getFullYear()}`;
}

/**
 * "YYYY-MM-DD" (a date <input>'s value) -> a local-midnight Date, matching
 * the app's "local-midnight dates" contract (lib/tasks/schedule.ts). Returns null for anything
 * malformed or for a date that doesn't exist (2026-02-30 would otherwise silently roll to
 * March 2 via the Date constructor).
 */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Local date -> "YYYY-MM-DD", for a date <input>'s value/max. Server-side only. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * When a calendar-feed event happens, in words (Phase 18.5). All-day events are stored as
 * UTC midnight of their date, so they're read in UTC; timed events are instants shown in
 * the household's zone. "Mon, Oct 12", "Oct 12 – 14", "Mon, Oct 5, 6:00 PM".
 */
export function formatEventWhen(e: { startsAt: Date; endsAt: Date; allDay: boolean }, timeZone: string): string {
  if (e.allDay) {
    const day = (d: Date) => d.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    const lastDay = new Date(e.endsAt.getTime() - 86_400_000);
    return lastDay > e.startsAt ? `${day(e.startsAt)} – ${day(lastDay)}` : day(e.startsAt);
  }
  return e.startsAt.toLocaleString(undefined, { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
