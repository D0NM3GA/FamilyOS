import { addDays, atMidnight, daysBetween } from "@/lib/tasks/schedule";
import { formatMonthDay } from "@/lib/format";
import type { CalendarEvent } from "@/lib/graph/calendar";
import type { ImportantDateRow, SchoolDueRow, SchoolEventRow, TaskRow, VehicleDueRow } from "./sources";

/**
 * The family calendar's agenda (/calendar), as pure functions: rows from every app in, one
 * Sunday-to-Saturday week of days out. No I/O, so the week, day and ordering rules are
 * unit-tested (agenda.test.ts).
 *
 * Days: every date the app stores is a server-local midnight (lib/tasks/schedule.ts), so a
 * day is keyed by its local "YYYY-MM-DD". Outside calendars are mapped onto those keys: an
 * all-day event (school feeds, Outlook) is UTC midnight of its date, so it's read in UTC; a
 * timed one is an instant, read in the household's zone, like lib/format's formatEventWhen.
 */

export type AgendaKind = "date" | "bill" | "outlook" | "schoolEvent" | "vehicle" | "school" | "homework" | "med" | "chore" | "meal";
export type AgendaStatus = "open" | "done" | "skipped";

export type AgendaItem = {
  /** Unique within a week, also the React key. */
  key: string;
  kind: AgendaKind;
  emoji: string;
  title: string;
  /** Who it's for or about: an assignee, a student, a car. */
  who: string | null;
  /** Phase 60: the family member it belongs to (chores, doses, schoolwork, a kid's school feed), for the filter and colours. */
  whoId?: string | null;
  /** Local "YYYY-MM-DD". */
  day: string;
  /** Minutes after midnight; null for an all-day item. */
  minutes: number | null;
  status: AgendaStatus;
  /** A short extra ("turns 40", a location, "through Oct 14"). */
  note: string | null;
  href: string | null;
  /** Opens outside the app (Outlook on the web). */
  external: boolean;
};

export type AgendaDay = { key: string; date: Date; isToday: boolean; isPast: boolean; items: AgendaItem[] };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** A local date's key. */
export const dayKey = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());

/** An all-day event's date: it's stored as UTC midnight of that date. */
export const utcDayKey = (d: Date) => ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

/** An instant's wall-clock day and minutes after midnight in `timeZone`. */
export function zonedDayAndMinutes(d: Date, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { day: ymd(get("year"), get("month"), get("day")), minutes: get("hour") * 60 + get("minute") };
}

/** Local midnight of the Sunday on or before `d`. */
export function weekStartOf(d: Date): Date {
  const day = atMidnight(d);
  return addDays(day, -day.getDay());
}

/** How far from this week the `?week=` link may go: plenty for planning, and no year 275760. */
const MAX_WEEKS_AWAY = 520;

/**
 * The week a `?week=YYYY-MM-DD` link asks for, snapped back to its Sunday. Anything missing,
 * malformed, a date that doesn't exist or more than ten years away is this week.
 */
export function parseWeekParam(value: string | string[] | undefined, today: Date): Date {
  const thisWeek = weekStartOf(today);
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  if (!match) return thisWeek;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return thisWeek;
  const start = weekStartOf(date);
  return Math.abs(daysBetween(thisWeek, start)) > MAX_WEEKS_AWAY * 7 ? thisWeek : start;
}

/** The seven local midnights of the week starting `start`. */
export function weekDays(start: Date, days = 7): Date[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

/** "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026", "Dec 27, 2026 – Jan 2, 2027". */
export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const from = formatMonthDay(start.getMonth() + 1, start.getDate());
  if (start.getFullYear() !== end.getFullYear()) {
    return `${from}, ${start.getFullYear()} – ${formatMonthDay(end.getMonth() + 1, end.getDate())}, ${end.getFullYear()}`;
  }
  const to = start.getMonth() === end.getMonth() ? String(end.getDate()) : formatMonthDay(end.getMonth() + 1, end.getDate());
  return `${from} – ${to}, ${end.getFullYear()}`;
}

/** "This week", "Next week", "3 weeks ago". */
export function relativeWeekLabel(start: Date, today: Date): string {
  const weeks = Math.round(daysBetween(weekStartOf(today), start) / 7);
  if (weeks === 0) return "This week";
  if (weeks === 1) return "Next week";
  if (weeks === -1) return "Last week";
  return weeks > 1 ? `In ${weeks} weeks` : `${-weeks} weeks ago`;
}

/** "8:00 AM", "12:30 PM": the same text on the server and in any browser. */
export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** Within a day, all-day items come first, in this order; timed ones follow by time. */
const KIND_ORDER: Record<AgendaKind, number> = {
  date: 0,
  bill: 1,
  outlook: 2,
  schoolEvent: 3,
  vehicle: 4,
  school: 5,
  homework: 6,
  med: 7,
  chore: 8,
  // Phase 65d: today's dinner, on Home's strip.
  meal: 9,
};

export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  if (a.minutes == null && b.minutes != null) return -1;
  if (a.minutes != null && b.minutes == null) return 1;
  if (a.minutes != null && b.minutes != null && a.minutes !== b.minutes) return a.minutes - b.minutes;
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title) || (a.who ?? "").localeCompare(b.who ?? "") || a.key.localeCompare(b.key);
}

/** The week's seven days, each with its items in order. Items outside the week are dropped. */
export function groupIntoDays(items: readonly AgendaItem[], start: Date, today: Date, count = 7): AgendaDay[] {
  const todayKey = dayKey(today);
  const days = weekDays(start, count).map((date) => {
    const key = dayKey(date);
    return { key, date, isToday: key === todayKey, isPast: key < todayKey, items: [] as AgendaItem[] };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const item of items) byKey.get(item.day)?.items.push(item);
  for (const day of days) day.items.sort(compareAgendaItems);
  return days;
}

const TO_DO_KINDS: ReadonlySet<AgendaKind> = new Set(["chore", "med", "school", "homework", "vehicle"]);

/** Something that needed doing on a day that's gone, and still isn't done. Events are never late. */
export function isLate(item: AgendaItem, day: AgendaDay): boolean {
  return day.isPast && item.status === "open" && TO_DO_KINDS.has(item.kind);
}

const FREE_DAY_LINES = [
  "Nothing planned. A free day! 🎈",
  "Wide open. Picnic, anyone? 🧺",
  "All clear. ☀️",
  "No plans yet. 🌈",
  "A blank page. ✏️",
];

/** What an empty day says: a friendly line for today and later, the same one on every visit. */
export function emptyDayLine(day: AgendaDay): string {
  if (day.isPast) return "Nothing on this day.";
  return FREE_DAY_LINES[day.date.getDate() % FREE_DAY_LINES.length];
}

/* ---- Rows from each app, as agenda items ---- */

/**
 * Birthdays, anniversaries and other yearly dates that land in the week. A Feb 29 date
 * shows on Feb 28 in other years (as Outlook does), and nothing shows before the year it
 * happened, when that's known.
 */
export function importantDateItems(dates: readonly ImportantDateRow[], start: Date, days = 7): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const date of weekDays(start, days)) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const leap = new Date(y, 1, 29).getMonth() === 1;
    for (const row of dates) {
      const lands = row.month === m && (row.day === d || (!leap && m === 2 && row.day === 29 && d === 28));
      if (!lands || (row.year != null && y < row.year)) continue;
      const years = row.year != null ? y - row.year : null;
      const base = { key: `date:${row.id}:${y}`, kind: "date" as const, day: dayKey(date), minutes: null, status: "open" as const, href: `/people/${encodeURIComponent(row.personId)}`, external: false };
      if (row.type === "BIRTHDAY") {
        items.push({ ...base, emoji: "🎂", title: `${row.personName}'s birthday`, who: null, note: years ? `turns ${years}` : null });
      } else if (row.type === "ANNIVERSARY") {
        items.push({ ...base, emoji: "💍", title: `${row.personName}'s anniversary`, who: null, note: years ? `${years} ${years === 1 ? "year" : "years"}` : null });
      } else {
        items.push({ ...base, emoji: "📅", title: row.label || "Important date", who: row.personName, note: null });
      }
    }
  }
  return items;
}

/** Chores and doses: a dose keeps its time; a chore is for the whole day. */
export function taskItems(rows: readonly TaskRow[]): AgendaItem[] {
  return rows.map((t): AgendaItem => {
    const med = t.domain === "MED";
    return {
      key: `${med ? "med" : "chore"}:${t.id}`,
      kind: med ? "med" : "chore",
      emoji: med ? "💊" : "🧹",
      title: t.title,
      who: t.assigneeName,
      whoId: t.assigneeId,
      day: dayKey(t.dueDate),
      minutes: t.timed ? t.dueDate.getHours() * 60 + t.dueDate.getMinutes() : null,
      status: t.status === "DONE" ? "done" : t.status === "SKIPPED" ? "skipped" : "open",
      note: null,
      href: med ? "/meds" : "/chores",
      external: false,
    };
  });
}

const schoolHref = (studentId: string | null) => (studentId ? `/school?kid=${encodeURIComponent(studentId)}` : "/school");

/** Forms, fees and to-dos, and homework, on the day they're due. */
export function schoolDueItems(rows: readonly SchoolDueRow[]): AgendaItem[] {
  return rows.map((s): AgendaItem => ({
    key: `${s.kind === "task" ? "school" : "homework"}:${s.id}`,
    kind: s.kind === "task" ? "school" : "homework",
    emoji: s.kind === "task" ? "🎒" : "📝",
    title: s.title,
    who: s.who,
    whoId: s.studentId,
    day: dayKey(s.dueDate),
    minutes: null,
    status: s.done ? "done" : "open",
    note: s.missing ? "marked missing" : null,
    href: schoolHref(s.studentId),
    external: false,
  }));
}

/**
 * An all-day event (UTC-midnight dates, end exclusive) on each day of the week it covers.
 * One that ends where it starts still lasts its day (lib/school/feeds/parse.ts).
 */
function allDaySpan(startsAt: Date, endsAt: Date, start: Date, days: number): { day: string; multiDay: boolean }[] {
  const first = utcDayKey(startsAt);
  const lastExclusive = endsAt > startsAt ? utcDayKey(endsAt) : null;
  const multiDay = lastExclusive != null && utcDayKey(new Date(endsAt.getTime() - 86_400_000)) !== first;
  return weekDays(start, days)
    .map(dayKey)
    .filter((key) => (lastExclusive == null ? key === first : key >= first && key < lastExclusive))
    .map((day) => ({ day, multiDay }));
}

/** "through Oct 14": the last day of a multi-day all-day event. */
function throughNote(endsAt: Date): string {
  const last = new Date(endsAt.getTime() - 86_400_000);
  return `through ${formatMonthDay(last.getUTCMonth() + 1, last.getUTCDate())}`;
}

/** "until Sun 2:00 PM": when a timed event that runs over several days ends, in the household's zone. */
function untilNote(endsAt: Date, timeZone: string): string {
  return `until ${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(endsAt)}`;
}

/**
 * Outside calendar events (school feeds, Outlook) on every day they cover. Phase 66a: a timed one
 * that runs past midnight (a weekend trip, camp) shows on each day too, at its start time on the
 * first and all day after, each with when it ends; before, it showed on its first day only, and
 * not at all in a week it began before. One that ends at midnight stays on its one day.
 */
function eventItems(
  e: { key: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean; place: string | null },
  start: Date,
  timeZone: string,
  days: number,
): { day: string; minutes: number | null; note: string | null; key: string }[] {
  if (e.allDay) {
    return allDaySpan(e.startsAt, e.endsAt, start, days).map(({ day, multiDay }) => ({
      day,
      minutes: null,
      note: multiDay ? throughNote(e.endsAt) : e.place,
      key: `${e.key}:${day}`,
    }));
  }
  const first = zonedDayAndMinutes(e.startsAt, timeZone);
  const lastDay = e.endsAt > e.startsAt ? zonedDayAndMinutes(new Date(e.endsAt.getTime() - 1), timeZone).day : first.day;
  if (lastDay <= first.day) return [{ day: first.day, minutes: first.minutes, note: e.place, key: e.key }];
  const note = [untilNote(e.endsAt, timeZone), e.place].filter(Boolean).join(" · ");
  return weekDays(start, days)
    .map(dayKey)
    .filter((day) => day >= first.day && day <= lastDay)
    .map((day) => ({ day, minutes: day === first.day ? first.minutes : null, note, key: `${e.key}:${day}` }));
}

export function schoolEventItems(rows: readonly SchoolEventRow[], start: Date, timeZone: string, days = 7): AgendaItem[] {
  return rows.flatMap((r) =>
    eventItems({ key: `feed:${r.key}`, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt, allDay: r.allDay, place: r.location }, start, timeZone, days).map(
      (at) => ({
        ...at,
        kind: "schoolEvent" as const,
        emoji: "🏫",
        title: r.title,
        who: r.who,
        whoId: r.studentId,
        status: "open" as const,
        href: schoolHref(r.studentId),
        external: false,
      }),
    ),
  );
}

export function vehicleItems(rows: readonly VehicleDueRow[]): AgendaItem[] {
  return rows.map((v): AgendaItem => ({
    key: `vehicle:${v.itemId}`,
    kind: "vehicle",
    emoji: "🔧",
    title: `${v.title} due`,
    who: v.vehicleName,
    day: dayKey(v.dueByDate),
    minutes: null,
    status: "open",
    note: null,
    href: `/vehicles/${encodeURIComponent(v.vehicleId)}`,
    external: false,
  }));
}

export function outlookItems(events: readonly CalendarEvent[], start: Date, timeZone: string, days = 7): AgendaItem[] {
  return events.flatMap((e) =>
    eventItems({ key: `outlook:${e.id}`, title: e.subject, startsAt: e.start, endsAt: e.end, allDay: e.isAllDay, place: e.location }, start, timeZone, days).map(
      (at) => ({
        ...at,
        kind: "outlook" as const,
        emoji: "📆",
        title: e.subject,
        who: e.who ?? null,
        whoId: e.whoId ?? null,
        status: "open" as const,
        href: e.webLink,
        external: e.webLink != null,
      }),
    ),
  );
}

/** Kinds whose `who` is a family member's first name (a car's name or a contact's full name isn't). */
const PERSON_KINDS: ReadonlySet<AgendaKind> = new Set(["chore", "med", "school", "homework", "schoolEvent", "outlook"]);

/** The family member (their id) a row belongs to, if any. By id since Phase 60, so two sharing a first name keep apart. */
export function itemPerson(item: AgendaItem, members: ReadonlySet<string>): string | null {
  return PERSON_KINDS.has(item.kind) && item.whoId && members.has(item.whoId) ? item.whoId : null;
}

/** One person's rows, plus what's nobody's in particular (a birthday, a school event). */
export function itemsForPerson(items: readonly AgendaItem[], who: string, members: ReadonlySet<string>): AgendaItem[] {
  return items.filter((item) => (itemPerson(item, members) ?? who) === who);
}

/** The first of the month a `?month=YYYY-MM` link asks for; anything else, or too far away, is this month. */
export function parseMonthParam(value: string | string[] | undefined, today: Date): Date {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw.trim()) : null;
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!match) return thisMonth;
  const asked = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return Math.abs(asked.getFullYear() - today.getFullYear()) > 10 ? thisMonth : asked;
}

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const shiftMonth = (first: Date, by: number) => new Date(first.getFullYear(), first.getMonth() + by, 1);
export const monthLabel = (first: Date) => first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
/** A month's grid is always six weeks, starting on the Sunday on or before the 1st. */
export const MONTH_GRID_DAYS = 42;

/**
 * Phase 63b: a bill's name on its due day (lib/finance/calendar-bills.ts gives only names and
 * days, for the viewer's own jars). An event, not a to-do or anyone's; it links to Money's jar list.
 */
export function billItems(rows: readonly { day: string; name: string }[]): AgendaItem[] {
  return rows.map((b) => ({
    key: `bill:${b.day}:${b.name}`,
    kind: "bill" as const,
    emoji: "💸",
    title: b.name,
    who: null,
    day: b.day,
    minutes: null,
    status: "open" as const,
    note: "bill due",
    href: "/finances",
    external: false,
  }));
}


/** Phase 64a: Home's Today strip shows this many, then "and N more". */
export const TODAY_STRIP_MAX = 8;

/** Today's items for Home's strip, in the day's order (all-day first, then by time), capped. Pure. */
export function todayStrip(items: readonly AgendaItem[], max = TODAY_STRIP_MAX): { shown: AgendaItem[]; more: number } {
  const sorted = [...items].sort(compareAgendaItems);
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

/** Phase 69c: planned dinners, one all-day row per day, opening the meal plan. */
export function mealItems(rows: readonly { day: Date; label: string }[]): AgendaItem[] {
  return rows.map((r) => ({
    key: `meal:${dayKey(r.day)}`,
    kind: "meal" as const,
    emoji: "🍽️",
    title: `Dinner: ${r.label}`,
    who: null,
    day: dayKey(r.day),
    minutes: null,
    status: "open" as const,
    note: null,
    href: "/groceries/meals",
    external: false,
  }));
}
