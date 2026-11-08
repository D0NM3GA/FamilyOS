import { AppTokenError, getAppGraphToken, GRAPH_SCOPE, invalidateAppToken } from "./app-token";
import { SOURCE_PROPERTY_ID } from "./source-property";

/**
 * Phase 70a: reading family members' Outlook calendars with the app's own token, without anyone
 * signed in. Exchange "RBAC for Applications" grants `Application Calendars.Read` scoped to a group
 * of the family's mailboxes (README "Outlook calendars"); the app has no Graph permission in Entra,
 * so nothing outside that group is readable. Never throws for Graph's answers: they become fixed
 * text, which may be shown and logged (never a title or an address).
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/** One page; Graph pages the rest by @odata.nextLink. */
const PAGE = 200;
/** The most events kept from one calendar: two months of a very busy family, with room. */
export const MAX_COPIED_EVENTS = 1000;

export type CopiedEvent = {
  graphId: string;
  iCalUId: string | null;
  title: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  isPrivate: boolean;
};

type GraphEvent = {
  id: string;
  iCalUId?: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  sensitivity?: string;
  location?: { displayName?: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
};

export const COPY_ERRORS = {
  setup: "Microsoft sign-in isn't set up on the server.",
  denied: "Outlook didn't let the app read this calendar. Check the Exchange setup in the README (Outlook calendars).",
  missing: "That mailbox or calendar wasn't found in Outlook.",
  busy: "Outlook asked the app to wait. It'll try again later.",
  failed: "The calendar couldn't be copied just now. It'll try again later.",
  truncated: "This calendar is very large; only part of it is shown.",
} as const;

export type ReadResult =
  | { ok: true; events: CopiedEvent[]; truncated: boolean }
  | { ok: false; error: string; retryAfterSeconds?: number | null };

/** We never send an outlook.timezone preference, so every time comes back in UTC. */
function parseUtc(dateTime: string, timeZone: string): Date {
  return timeZone === "UTC" ? new Date(`${dateTime}Z`) : new Date(dateTime);
}

const clip = (s: string | undefined | null, n: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : null;
};

/**
 * Graph's events to what's kept. Events the app wrote itself (the write-back's tag) are dropped;
 * a private or confidential event keeps no title or place. Pure, for tests.
 */
export function parseCopiedEvents(values: readonly GraphEvent[]): CopiedEvent[] {
  const out: CopiedEvent[] = [];
  for (const e of values) {
    if (e.singleValueExtendedProperties?.some((p) => p.id.toLowerCase() === SOURCE_PROPERTY_ID.toLowerCase())) continue;
    const startsAt = parseUtc(e.start.dateTime, e.start.timeZone);
    const endsAt = parseUtc(e.end.dateTime, e.end.timeZone);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
    const isPrivate = e.sensitivity === "private" || e.sensitivity === "confidential";
    out.push({
      graphId: e.id,
      iCalUId: clip(e.iCalUId, 400),
      title: isPrivate ? null : (clip(e.subject, 300) ?? "(No subject)"),
      location: isPrivate ? null : clip(e.location?.displayName, 300),
      startsAt,
      endsAt: endsAt > startsAt ? endsAt : startsAt,
      allDay: e.isAllDay === true,
      isPrivate,
    });
  }
  return out;
}

/** The Graph path of a mailbox's calendar: the main one, or one by id. */
export function calendarPath(mailbox: string, graphCalendarId: string | null): string {
  const user = `/users/${encodeURIComponent(mailbox)}`;
  return graphCalendarId ? `${user}/calendars/${encodeURIComponent(graphCalendarId)}` : `${user}/calendar`;
}

type Deps = { fetchFn?: typeof fetch; token?: () => Promise<string> };

async function appGet(path: string, deps: Deps): Promise<{ status: number; json: unknown; retryAfter: number | null }> {
  const token = await (deps.token ?? getAppGraphToken)();
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`;
  const res = await (deps.fetchFn ?? fetch)(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Immutable ids, so an event keeps its id when it's moved or its series is edited.
      Prefer: `IdType="ImmutableId"`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const raw = res.headers.get("retry-after");
  return { status: res.status, json, retryAfter: raw && /^\d+$/.test(raw) ? Number(raw) : null };
}

function failure(status: number, retryAfter: number | null): ReadResult & { ok: false } {
  if (status === 401 || status === 403) {
    // A role applied or removed since the token was minted: the next try gets a fresh one.
    invalidateAppToken(GRAPH_SCOPE);
    return { ok: false, error: COPY_ERRORS.denied };
  }
  if (status === 404) return { ok: false, error: COPY_ERRORS.missing };
  if (status === 429 || status === 503) return { ok: false, error: COPY_ERRORS.busy, retryAfterSeconds: retryAfter };
  return { ok: false, error: COPY_ERRORS.failed };
}

/** Only Graph's own host: a nextLink is followed with the app's token. */
const isGraphLink = (link: unknown): link is string => typeof link === "string" && link.startsWith(`${GRAPH_BASE}/`);

/** Every event overlapping [start, end) in one calendar, up to MAX_COPIED_EVENTS. */
export async function readCalendarView(
  mailbox: string,
  graphCalendarId: string | null,
  range: { start: Date; end: Date },
  deps: Deps = {},
): Promise<ReadResult> {
  const params = new URLSearchParams({
    startDateTime: range.start.toISOString(),
    endDateTime: range.end.toISOString(),
    $select: "subject,start,end,isAllDay,location,sensitivity,iCalUId",
    $expand: `singleValueExtendedProperties($filter=id eq '${SOURCE_PROPERTY_ID}')`,
    $orderby: "start/dateTime",
    $top: String(PAGE),
  });
  let next: string | null = `${calendarPath(mailbox, graphCalendarId)}/calendarView?${params}`;
  const raw: GraphEvent[] = [];
  try {
    while (next && raw.length < MAX_COPIED_EVENTS) {
      const res = await appGet(next, deps);
      if (res.status !== 200) return failure(res.status, res.retryAfter);
      const body = res.json as { value?: GraphEvent[]; "@odata.nextLink"?: string } | null;
      raw.push(...(body?.value ?? []));
      next = isGraphLink(body?.["@odata.nextLink"]) ? body["@odata.nextLink"] : null;
    }
  } catch (err) {
    if (err instanceof AppTokenError) return { ok: false, error: COPY_ERRORS.setup };
    return { ok: false, error: COPY_ERRORS.failed };
  }
  return { ok: true, events: parseCopiedEvents(raw.slice(0, MAX_COPIED_EVENTS)), truncated: next !== null };
}

export type MailboxCalendar = { id: string; name: string; isDefault: boolean };

/** A mailbox's calendars, for picking the family one (and for Check access). Main one first. */
export async function listMailboxCalendars(mailbox: string, deps: Deps = {}): Promise<{ ok: true; calendars: MailboxCalendar[] } | { ok: false; error: string }> {
  try {
    const res = await appGet(`/users/${encodeURIComponent(mailbox)}/calendars?$select=id,name,isDefaultCalendar&$top=100`, deps);
    if (res.status !== 200) {
      const f = failure(res.status, res.retryAfter);
      return { ok: false, error: f.error };
    }
    const body = res.json as { value?: { id: string; name?: string; isDefaultCalendar?: boolean }[] } | null;
    const calendars = (body?.value ?? [])
      .map((c) => ({ id: c.id, name: c.name || "(No name)", isDefault: c.isDefaultCalendar === true }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return { ok: true, calendars };
  } catch (err) {
    if (err instanceof AppTokenError) return { ok: false, error: COPY_ERRORS.setup };
    return { ok: false, error: COPY_ERRORS.failed };
  }
}
