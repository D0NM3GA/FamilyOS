import { atMidnight, addDays } from "@/lib/tasks/schedule";
import { getGraphToken, graphFetchJson, graphRequest, GraphAuthError } from "./client";

export type CalendarEvent = {
  id: string;
  subject: string;
  /**
   * Graph returns an all-day event as midnight to midnight of its date in the zone asked
   * for (always UTC here), so its date is read in UTC; a timed one is a real instant.
   */
  start: Date;
  end: Date;
  isAllDay: boolean;
  location: string | null;
  /** Opens the event in Outlook on the web. Only ever an https link. */
  webLink: string | null;
  /** Phase 70a: whose own calendar it came from (the copy), by first name and id. */
  who?: string | null;
  whoId?: string | null;
  /** Phase 70b: who's driving (the copy), and where a grown-up sets it. */
  driver?: string | null;
  driveHref?: string | null;
};

type GraphEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName?: string };
  webLink?: string;
};

type GraphCalendar = { id: string; name: string };

/**
 * Which calendar FAMILY_CALENDAR_NAME is, per signed-in owner: a calendar's id doesn't change,
 * so Home makes one Graph call instead of two. Per process, a few hours at most, and dropped
 * when the calendar stops answering (renamed or removed).
 */
const calendarIds = new Map<string, { basePath: string; until: number }>();
const CALENDAR_ID_TTL_MS = 6 * 60 * 60 * 1000;

/** We only ever request UTC (no Prefer header), so timeZone is always expected to be "UTC". */
function parseGraphDateTime(dateTime: string, timeZone: string): Date {
  if (timeZone === "UTC") return new Date(`${dateTime}Z`);
  return new Date(dateTime); // best-effort fallback for any other zone
}

/** `truncated`: Outlook had more events in the range than were asked for. */
export type CalendarEventsResult = { ok: true; events: CalendarEvent[]; truncated: boolean } | { ok: false; error: string };
export type ThisWeekResult = CalendarEventsResult;

/**
 * The default calendar (`/me/calendar`) is just the user's own primary calendar — a
 * synced-in calendar like a family Google Calendar shows up as a separate entry in
 * `/me/calendars` and is invisible to `/me/calendar/calendarView`. Phase 45.2: the one this
 * person picked for Home (Settings → Calendar on Home, kept by id, so a rename in Outlook
 * doesn't break it); else FAMILY_CALENDAR_NAME, looked up by name, the install's default;
 * else the default calendar, so this still works for a simpler single-calendar setup.
 */
async function resolveCalendarBasePath(ownerKey: string, chosenId: string | null): Promise<
  { ok: true; basePath: string } | { ok: false; error: string }
> {
  if (chosenId) return { ok: true, basePath: `/me/calendars/${encodeURIComponent(chosenId)}` };
  const targetName = process.env.FAMILY_CALENDAR_NAME?.trim();
  if (!targetName) return { ok: true, basePath: "/me/calendar" };

  const cacheKey = `${ownerKey}:${targetName.toLowerCase()}`;
  const cached = calendarIds.get(cacheKey);
  if (cached && cached.until > Date.now()) return { ok: true, basePath: cached.basePath };

  const calendars = await graphFetchJson<{ value: GraphCalendar[] }>(
    `/me/calendars?$select=id,name`,
  );
  const match = calendars.value.find(
    (c) => c.name.toLowerCase() === targetName.toLowerCase(),
  );
  if (!match) {
    return {
      ok: false,
      error: "The family calendar wasn't found in your Outlook. Pick the one to show in Settings → Calendar on Home.",
    };
  }

  const basePath = `/me/calendars/${match.id}`;
  calendarIds.set(cacheKey, { basePath, until: Date.now() + CALENDAR_ID_TTL_MS });
  return { ok: true, basePath };
}

export type MyCalendar = { id: string; name: string; isDefault: boolean };

/**
 * Phase 45.2: the signed-in person's own Outlook calendars, for Settings → Calendar on Home.
 * Only for the session's owner (Graph tokens are per sign-in). Default first, then by name.
 */
export async function listMyCalendars(): Promise<{ ok: true; calendars: MyCalendar[] } | { ok: false; error: string }> {
  try {
    const data = await graphFetchJson<{ value: (GraphCalendar & { isDefaultCalendar?: boolean })[] }>(
      `/me/calendars?$select=id,name,isDefaultCalendar&$top=100`,
    );
    const calendars = data.value
      .map((c) => ({ id: c.id, name: c.name || "(No name)", isDefault: c.isDefaultCalendar === true }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return { ok: true, calendars };
  } catch (err) {
    if (err instanceof GraphAuthError) return { ok: false, error: err.message };
    return { ok: false, error: "Couldn't load your calendars from Outlook right now." };
  }
}

/** Graph builds this link itself, but it's still outside data headed for an href. */
function safeWebLink(link: string | undefined): string | null {
  return link && link.startsWith("https://") ? link : null;
}

/** The most events one range asks Outlook for: a busy family week, with room to spare. */
const MAX_EVENTS = 200;

/**
 * Events overlapping [start, end) from the configured family calendar, soonest first.
 * `ownerKey` is the signed-in Microsoft user the token belongs to (it keys the calendar id);
 * only ever call this for the active profile that IS that user (isSessionOwner).
 */
export async function getCalendarEvents(
  ownerKey: string,
  range: { start: Date; end: Date },
  opts: { max?: number; calendarId?: string | null } = {},
): Promise<CalendarEventsResult> {
  if (!(range.end > range.start)) return { ok: true, events: [], truncated: false };
  const max = Math.min(Math.max(1, opts.max ?? MAX_EVENTS), MAX_EVENTS);

  try {
    const resolved = await resolveCalendarBasePath(ownerKey, opts.calendarId ?? null);
    if (!resolved.ok) return resolved;

    const params = new URLSearchParams({
      startDateTime: range.start.toISOString(),
      endDateTime: range.end.toISOString(),
      $select: "subject,start,end,isAllDay,location,webLink",
      $orderby: "start/dateTime",
      $top: String(max),
    });

    let data: { value: GraphEvent[]; "@odata.nextLink"?: string };
    try {
      data = await graphFetchJson<{ value: GraphEvent[]; "@odata.nextLink"?: string }>(`${resolved.basePath}/calendarView?${params}`);
    } catch (err) {
      for (const [key, entry] of calendarIds) if (entry.basePath === resolved.basePath) calendarIds.delete(key);
      // Phase 45.2: a picked calendar that's been deleted (or unshared) says so, in words.
      if (opts.calendarId && err instanceof Error && / 404 /.test(err.message)) {
        return { ok: false, error: "The calendar you picked for Home isn't in your Outlook anymore. Pick another in Settings → Calendar on Home." };
      }
      throw err;
    }

    const events: CalendarEvent[] = data.value.map((e) => ({
      id: e.id,
      subject: e.subject || "(No subject)",
      start: parseGraphDateTime(e.start.dateTime, e.start.timeZone),
      end: parseGraphDateTime(e.end.dateTime, e.end.timeZone),
      isAllDay: e.isAllDay,
      location: e.location?.displayName || null,
      webLink: safeWebLink(e.webLink),
    }));

    return { ok: true, events, truncated: Boolean(data["@odata.nextLink"]) };
  } catch (err) {
    if (err instanceof GraphAuthError) return { ok: false, error: err.message };
    return { ok: false, error: "Couldn't load the calendar right now." };
  }
}

/** Sunday-through-Saturday of the current week (Home's card), at most 25 events. */
export async function getThisWeekEvents(ownerKey: string, calendarId: string | null = null): Promise<ThisWeekResult> {
  const today = atMidnight(new Date());
  const startOfWeek = addDays(today, -today.getDay());
  return getCalendarEvents(ownerKey, { start: startOfWeek, end: addDays(startOfWeek, 7) }, { max: 25, calendarId });
}

/**
 * Phase 64b: adds one event to the calendar this person's Home and Calendar read (their pick in
 * Settings, else the family calendar by name, else their own), with their own token: only for the
 * session's owner, who granted calendar write access. Never throws; Graph's answers become fixed
 * text.
 */
export async function addEventToHomeCalendar(ownerKey: string, chosenId: string | null, payload: object): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const where = await resolveCalendarBasePath(ownerKey, chosenId);
    if (!where.ok) return where;
    const token = await getGraphToken();
    const res = await graphRequest(token, "POST", `${where.basePath}/events`, payload);
    if (res.status === 201 || res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, error: "Your Microsoft sign-in needs refreshing: sign out and back in, then try again." };
    if (res.status === 403) return { ok: false, error: "Outlook hasn't let the app add events yet. Grant it under Calendar → Outlook sync, then try again." };
    if (res.status === 404) {
      // A renamed or recreated family calendar: forget the remembered id, as reads do.
      for (const [k, e] of calendarIds) if (e.basePath === where.basePath) calendarIds.delete(k);
      return {
        ok: false,
        error: chosenId
          ? "That calendar isn't in your Outlook any more. Pick another in Settings → Calendar on Home."
          : "The family calendar wasn't found in your Outlook. Pick the one to show in Settings → Calendar on Home.",
      };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, error: "Outlook is busy right now. Try again in a minute." };
    return { ok: false, error: "Outlook didn't take that event." };
  } catch (err) {
    if (err instanceof GraphAuthError) return { ok: false, error: err.message };
    // Looking the family calendar up by name can be refused too (a missing permission).
    if (err instanceof Error && / 403 /.test(err.message)) return { ok: false, error: "Outlook hasn't let the app add events yet. Grant it under Calendar → Outlook sync, then try again." };
    return { ok: false, error: "Couldn't reach Outlook right now." };
  }
}
