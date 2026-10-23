import { createHash } from "node:crypto";
import { isAppOn } from "@/lib/apps";

/**
 * What the family calendar should contain (Phase 17), as pure functions: source rows in,
 * Graph event payloads out, each keyed by the row it mirrors. No I/O, so every rule here
 * is unit-tested.
 *
 * Time zones: every date in the app is built from the server's local midnight plus the
 * "HH:mm" the family typed (lib/tasks/schedule.ts), so events are sent as those wall-clock
 * values, labelled with the household's zone (Household.timezone, else the server's):
 * "18:00" means 6pm where the family lives (Fable's implementation review, Phase 17).
 */

export type EventPayload = {
  subject: string;
  body: { contentType: "text"; content: string };
  isAllDay: boolean;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: {
    pattern: { type: "absoluteYearly"; interval: 1; month: number; dayOfMonth: number };
    range: { type: "noEnd"; startDate: string };
  };
  showAs: "free";
  isReminderOn: false;
};

export type DesiredEvent = { sourceKey: string; payload: EventPayload; hash: string };

export type SyncSources = {
  dates: { id: string; type: "BIRTHDAY" | "ANNIVERSARY" | "OTHER"; label: string | null; month: number; day: number; year: number | null; personName: string }[];
  vehicles: { itemId: string; title: string; vehicleName: string; dueByDate: Date }[];
  tasks: { id: string; domain: "CHORE" | "MED"; title: string; dueDate: Date; timed: boolean; assigneeName: string | null }[];
  /** School (Phase 18): all-day on the due date. */
  school: { id: string; kind: "task" | "assignment"; title: string; dueDate: Date; who: string | null }[];
};

export type SyncOptions = {
  includeDates: boolean;
  includeVehicles: boolean;
  includeChores: boolean;
  includeMeds: boolean;
  includeSchoolTasks: boolean;
  includeAssignments: boolean;
};

/**
 * Phase 36: the family's choices on the Outlook page, minus the apps they turned off, so a
 * turned-off app's events leave the calendar on the next sync and come back when it's on.
 * The page's own checkboxes stay as they were, so turning an app back on restores them.
 */
export function syncOptionsWithApps<T extends SyncOptions>(options: T, disabled: readonly string[]): T {
  const on = (app: string) => isAppOn(disabled, app);
  return {
    ...options,
    includeVehicles: options.includeVehicles && on("cars"),
    includeChores: options.includeChores && on("chores"),
    includeMeds: options.includeMeds && on("meds"),
    includeSchoolTasks: options.includeSchoolTasks && on("school"),
    includeAssignments: options.includeAssignments && on("school"),
  };
}

export type Zones = { allDay: string; timed: string };

const FOOTER = "Added by your family app. Changes made here are replaced the next time it updates this event.";
const TIMED_MINUTES = 30;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** A Date's wall-clock date in the server's zone (how every date in this app is built). */
const localYmd = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
const localDateTime = (d: Date) => `${localYmd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

function nextDayYmd(y: number, m: number, d: number): string {
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function allDay(subject: string, y: number, m: number, d: number, zone: string, detail?: string): EventPayload {
  return {
    subject,
    body: { contentType: "text", content: detail ? `${detail}\n\n${FOOTER}` : FOOTER },
    isAllDay: true,
    // Graph's all-day rule: midnight to the next midnight, both in the same zone.
    start: { dateTime: `${ymd(y, m, d)}T00:00:00`, timeZone: zone },
    end: { dateTime: `${nextDayYmd(y, m, d)}T00:00:00`, timeZone: zone },
    showAs: "free",
    isReminderOn: false,
  };
}

/**
 * A yearly event's series starts in a fixed year, so the payload (and its hash) never
 * changes on its own: the person's birth or wedding year when known, else 2024. 2024 is a
 * leap year, so a Feb 29 date has a real first occurrence; Outlook then shows it on Feb 28
 * in other years.
 */
const SERIES_START_YEAR = 2024;

function importantDateEvent(d: SyncSources["dates"][number], zone: string): DesiredEvent {
  const what =
    d.type === "BIRTHDAY" ? `🎂 ${d.personName}'s birthday` : d.type === "ANNIVERSARY" ? `💍 ${d.personName}'s anniversary` : `📅 ${d.label || "Important date"}: ${d.personName}`;
  const startYear = d.year != null && (d.month !== 2 || d.day !== 29 || isLeap(d.year)) ? d.year : SERIES_START_YEAR;
  const payload: EventPayload = {
    ...allDay(what, startYear, d.month, d.day, zone),
    recurrence: {
      pattern: { type: "absoluteYearly", interval: 1, month: d.month, dayOfMonth: d.day },
      range: { type: "noEnd", startDate: ymd(startYear, d.month, d.day) },
    },
  };
  return withHash(`date:${d.id}`, payload);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function vehicleEvent(v: SyncSources["vehicles"][number], zone: string): DesiredEvent {
  const due = v.dueByDate;
  return withHash(
    `vehicle:${v.itemId}`,
    allDay(`🔧 ${v.vehicleName}: ${v.title} due`, due.getFullYear(), due.getMonth() + 1, due.getDate(), zone),
  );
}

function taskEvent(t: SyncSources["tasks"][number], zones: Zones): DesiredEvent {
  const icon = t.domain === "MED" ? "💊" : "🧹";
  const subject = t.assigneeName ? `${icon} ${t.title} (${t.assigneeName})` : `${icon} ${t.title}`;
  const key = `${t.domain === "MED" ? "med" : "chore"}:${t.id}`;
  if (!t.timed) {
    return withHash(key, allDay(subject, t.dueDate.getFullYear(), t.dueDate.getMonth() + 1, t.dueDate.getDate(), zones.allDay));
  }
  const end = new Date(t.dueDate.getTime() + TIMED_MINUTES * 60_000);
  return withHash(key, {
    subject,
    body: { contentType: "text", content: FOOTER },
    isAllDay: false,
    start: { dateTime: localDateTime(t.dueDate), timeZone: zones.timed },
    end: { dateTime: localDateTime(end), timeZone: zones.timed },
    showAs: "free",
    isReminderOn: false,
  });
}

function schoolEvent(s: SyncSources["school"][number], zone: string): DesiredEvent {
  const icon = s.kind === "task" ? "🎒" : "📝";
  const subject = s.who ? `${icon} ${s.title} (${s.who})` : `${icon} ${s.title}`;
  const d = s.dueDate;
  return withHash(`${s.kind === "task" ? "school" : "assignment"}:${s.id}`, allDay(subject, d.getFullYear(), d.getMonth() + 1, d.getDate(), zone));
}

/** sha256 over the exact payload sent, so any change to it is an update. */
export function hashPayload(payload: EventPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function withHash(sourceKey: string, payload: EventPayload): DesiredEvent {
  return { sourceKey, payload, hash: hashPayload(payload) };
}

export function buildDesiredEvents(sources: SyncSources, options: SyncOptions, zones: Zones): DesiredEvent[] {
  const events: DesiredEvent[] = [];
  if (options.includeDates) events.push(...sources.dates.map((d) => importantDateEvent(d, zones.allDay)));
  if (options.includeVehicles) events.push(...sources.vehicles.map((v) => vehicleEvent(v, zones.allDay)));
  for (const t of sources.tasks) {
    if ((t.domain === "CHORE" && options.includeChores) || (t.domain === "MED" && options.includeMeds)) events.push(taskEvent(t, zones));
  }
  for (const s of sources.school) {
    if ((s.kind === "task" && options.includeSchoolTasks) || (s.kind === "assignment" && options.includeAssignments)) events.push(schoolEvent(s, zones.allDay));
  }
  return events;
}
