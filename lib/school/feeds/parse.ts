import ICAL from "ical.js";

/**
 * iCalendar feed → event occurrences inside a window (Phase 18.5). Pure: text in, rows
 * out. The rules came out of Fable's scope reviews:
 * - A recurring series is iterated from its own DTSTART (starting the iterator at the
 *   window would shift rules whose day is implied by DTSTART), skipping occurrences
 *   before the window and stopping after it, with a step cap so a daily rule from 2010
 *   can't spin.
 * - Overrides (RECURRENCE-ID) are resolved through the master; cancelled ones are skipped.
 * - A TZID the feed doesn't define (no VTIMEZONE) comes out of ical.js as floating, so the
 *   TZID is read off the property and each occurrence's wall clock is converted with Intl
 *   in that zone. Truly floating times use the household's zone.
 * - All-day events are stored as UTC midnight of their date, end exclusive.
 * - One malformed series is skipped, never the whole feed.
 */

export type FeedEvent = {
  occurrenceKey: string;
  uid: string;
  title: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
};

export type ExpandOptions = { from: Date; to: Date; fallbackZone: string; maxEvents?: number; maxSteps?: number };

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;

// Phase 49: shared with lib/household-zone.ts; re-exported for the calendar and school queries.
export { wallClockToInstant } from "@/lib/zone-clock";
import { wallClockToInstant } from "@/lib/zone-clock";

const MAX_TEXT = 200;

function isValidZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function toInstant(t: Time, tzid: string | null, fallbackZone: string): { at: Date; allDay: boolean } {
  if (t.isDate) return { at: new Date(Date.UTC(t.year, t.month - 1, t.day)), allDay: true };
  const zone = t.zone?.tzid;
  if (zone === "UTC" || zone === "Z" || zone === "GMT") {
    return { at: new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)), allDay: false };
  }
  if (zone && zone !== "floating") return { at: t.toJSDate(), allDay: false };
  const wallZone = isValidZone(tzid) ? tzid : fallbackZone;
  return { at: wallClockToInstant(t.year, t.month, t.day, t.hour, t.minute, t.second, wallZone), allDay: false };
}

const tzidOf = (c: Component): string | null => {
  const value = c.getFirstProperty("dtstart")?.getParameter("tzid");
  return typeof value === "string" ? value : null;
};
const isCancelled = (c: Component) => String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
const text = (c: Component, name: string): string | null => {
  const v = c.getFirstPropertyValue(name);
  // Control characters (a stray NUL makes Postgres reject the whole refresh) are dropped.
  const s = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  return s ? s.slice(0, MAX_TEXT) : null;
};

export function expandFeed(ics: string, opts: ExpandOptions): { events: FeedEvent[]; truncated: boolean } {
  const maxEvents = opts.maxEvents ?? 5000;
  const maxSteps = opts.maxSteps ?? 20_000;
  const from = opts.from.getTime();
  const to = opts.to.getTime();
  const out = new Map<string, FeedEvent>();
  let truncated = false;

  const calendar = new ICAL.Component(ICAL.parse(ics));
  // The timezone registry is process-wide: register this feed's zones, and always clear
  // them afterwards so one feed's definitions can't leak into another's.
  try {
    for (const vtz of calendar.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(vtz);

    const masters = new Map<string, Component>();
    const exceptions = new Map<string, Component[]>();
    const standalone: Component[] = [];
    const duplicateUids = new Set<string>();
    for (const vevent of calendar.getAllSubcomponents("vevent")) {
      const uid = text(vevent, "uid");
      if (!uid) {
        standalone.push(vevent);
        continue;
      }
      if (vevent.hasProperty("recurrence-id")) exceptions.set(uid, [...(exceptions.get(uid) ?? []), vevent]);
      else if (masters.has(uid)) {
        // Some school systems reuse one UID for every day of a multi-day event. Keep them
        // all as one-offs (their start makes each key unique) instead of losing all but one.
        const earlier = masters.get(uid)!;
        const recurs = (c: Component) => c.hasProperty("rrule") || c.hasProperty("rdate");
        if (!recurs(earlier) && !recurs(vevent)) {
          standalone.push(vevent);
          if (!standalone.includes(earlier)) standalone.push(earlier);
          masters.delete(uid);
          duplicateUids.add(uid);
        } else masters.set(uid, vevent);
      } else if (duplicateUids.has(uid)) standalone.push(vevent);
      else masters.set(uid, vevent);
    }
    // An override whose master isn't in the feed is just a one-off event.
    for (const [uid, list] of exceptions) if (!masters.has(uid)) standalone.push(...list);

    const add = (uid: string, item: Component, start: Time, end: Time) => {
      if (isCancelled(item)) return;
      const tzid = tzidOf(item);
      const s = toInstant(start, tzid, opts.fallbackZone);
      const e = toInstant(end, tzid, opts.fallbackZone);
      const startMs = s.at.getTime();
      // An all-day event whose end equals its start (non-compliant, but common) still
      // lasts its day; otherwise it would vanish on the morning it happens.
      const endMs = s.allDay && e.at.getTime() <= startMs ? startMs + 86_400_000 : Math.max(e.at.getTime(), startMs);
      // Overlaps the window: ends are exclusive, so an all-day event ending at the window's
      // first midnight is outside it.
      if (startMs > to || (startMs < from && endMs <= from)) return;
      if (out.size >= maxEvents) {
        truncated = true;
        return;
      }
      const key = `${uid}|${s.at.toISOString()}`;
      out.set(key, {
        occurrenceKey: key,
        uid,
        title: text(item, "summary") ?? "(no title)",
        location: text(item, "location"),
        startsAt: s.at,
        endsAt: new Date(endMs),
        allDay: s.allDay,
      });
    };

    for (const [uid, master] of masters) {
      try {
        if (isCancelled(master)) continue;
        const event = new ICAL.Event(master, { exceptions: exceptions.get(uid) ?? [] });
        if (!event.isRecurring()) {
          add(uid, master, event.startDate, event.endDate);
          continue;
        }
        const masterTzid = tzidOf(master);
        const iterator = event.iterator();
        let steps = 0;
        for (let next = iterator.next(); next; next = iterator.next()) {
          if (++steps > maxSteps) {
            truncated = true;
            break;
          }
          if (toInstant(next, masterTzid, opts.fallbackZone).at.getTime() > to) break;
          const details = event.getOccurrenceDetails(next);
          add(uid, details.item.component, details.startDate, details.endDate);
          if (out.size >= maxEvents) break;
        }
      } catch {
        // A series ical.js can't expand (an impossible rule, a broken date) is skipped.
      }
    }
    for (const vevent of standalone) {
      try {
        const event = new ICAL.Event(vevent);
        add(text(vevent, "uid") ?? `${text(vevent, "summary")}|${vevent.getFirstPropertyValue("dtstart")}`, vevent, event.startDate, event.endDate);
      } catch {
        // Skip one broken event, keep the rest.
      }
    }
  } finally {
    ICAL.TimezoneService.reset();
  }

  return { events: [...out.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), truncated };
}
