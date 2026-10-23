const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The calendar day `date` falls on in `timeZone` (the process zone when omitted), as a day count
 * that subtracts cleanly. Phase 49: on the server the process zone is the household's; a client
 * component passes the household's zone (useHouseholdZone) so it shows the same day.
 */
function dayNumber(date: Date, timeZone?: string): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date)
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** "Today" / "3 days ago" / "in 5 days" / "Never" (for nulls) — coarse, human-facing. */
export function formatRelative(date: Date | null, timeZone?: string): string {
  if (!date) return "Never";

  const diffDays = dayNumber(date, timeZone) - dayNumber(new Date(), timeZone);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 30) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -30) return `${Math.abs(diffDays)} days ago`;

  return date.toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(date: Date, timeZone?: string): string {
  return date.toLocaleString(undefined, {
    timeZone,
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

/**
 * A date -> "YYYY-MM-DD" in `timeZone` (the process zone, the household's, when omitted), for a
 * date <input>'s value or max. A client component passes the household's zone.
 */
export function toISODate(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
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
