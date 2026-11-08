import { describe, expect, test } from "vitest";
import { COPY_ERRORS, MAX_COPIED_EVENTS, calendarPath, parseCopiedEvents, readCalendarView } from "./app-calendar";
import { SOURCE_PROPERTY_ID } from "./source-property";

const ev = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  subject: `Event ${id}`,
  start: { dateTime: "2026-11-10T21:30:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-11-10T22:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  sensitivity: "normal",
  ...extra,
});

describe("parseCopiedEvents", () => {
  test("keeps times in UTC, the title and the place", () => {
    const [e] = parseCopiedEvents([ev("a", { location: { displayName: "Field 3" }, iCalUId: "u1" })]);
    expect(e).toMatchObject({ graphId: "a", iCalUId: "u1", title: "Event a", location: "Field 3", allDay: false, isPrivate: false });
    expect(e.startsAt.toISOString()).toBe("2026-11-10T21:30:00.000Z");
  });

  test("a private or confidential event keeps no title or place", () => {
    for (const sensitivity of ["private", "confidential"]) {
      const [e] = parseCopiedEvents([ev("p", { sensitivity, location: { displayName: "Clinic" } })]);
      expect(e).toMatchObject({ title: null, location: null, isPrivate: true });
    }
  });

  test("drops the events the app's own write-back made", () => {
    const tagged = ev("w", { singleValueExtendedProperties: [{ id: SOURCE_PROPERTY_ID, value: "date:1" }] });
    expect(parseCopiedEvents([tagged, ev("k")]).map((e) => e.graphId)).toEqual(["k"]);
  });

  test("an all-day event is UTC midnight of its date", () => {
    const [e] = parseCopiedEvents([
      ev("d", { isAllDay: true, start: { dateTime: "2026-11-11T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-12T00:00:00.0000000", timeZone: "UTC" } }),
    ]);
    expect(e.allDay).toBe(true);
    expect(e.startsAt.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  test("no subject reads as (No subject)", () => {
    expect(parseCopiedEvents([ev("n", { subject: "" })])[0].title).toBe("(No subject)");
  });
});

test("calendarPath: the main calendar or one by id", () => {
  expect(calendarPath("ivy@example.com", null)).toBe("/users/ivy%40example.com/calendar");
  expect(calendarPath("0f", "AA=")).toBe("/users/0f/calendars/AA%3D");
});

describe("readCalendarView", () => {
  const range = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };
  const token = async () => "t";
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

  test("follows Graph's next page, asks for immutable ids, and stops at its own host", async () => {
    const seen: { url: string; prefer: string | null }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, prefer: new Headers(init.headers).get("prefer") });
      if (seen.length === 1) return json({ value: [ev("a")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/x/calendar/calendarView?$skiptoken=2" });
      return json({ value: [ev("b")], "@odata.nextLink": "https://evil.example/next" });
    }) as typeof fetch;
    const r = await readCalendarView("x", null, range, { fetchFn, token });
    expect(r.ok && r.events.map((e) => e.graphId)).toEqual(["a", "b"]);
    expect(seen).toHaveLength(2);
    expect(seen[0].prefer).toBe('IdType="ImmutableId"');
    expect(seen[0].url).toContain("sensitivity");
  });

  test("Outlook's refusals become fixed text", async () => {
    const one = (res: Response) => (async () => res) as unknown as typeof fetch;
    expect(await readCalendarView("x", null, range, { fetchFn: one(json({}, 403)), token })).toEqual({ ok: false, error: COPY_ERRORS.denied });
    expect(await readCalendarView("x", null, range, { fetchFn: one(json({}, 404)), token })).toEqual({ ok: false, error: COPY_ERRORS.missing });
    expect(await readCalendarView("x", null, range, { fetchFn: one(json({}, 429, { "retry-after": "30" })), token })).toEqual({ ok: false, error: COPY_ERRORS.busy, retryAfterSeconds: 30 });
    const boom = (async () => {
      throw new Error("socket hang up ivy@example.com");
    }) as unknown as typeof fetch;
    expect(await readCalendarView("x", null, range, { fetchFn: boom, token })).toEqual({ ok: false, error: COPY_ERRORS.failed });
  });

  test("stops at the cap and says it's truncated", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      return json({ value: Array.from({ length: 200 }, (_, i) => ev(`${n}-${i}`)), "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" });
    }) as unknown as typeof fetch;
    const r = await readCalendarView("x", null, range, { fetchFn, token });
    expect(r.ok && r.events.length).toBe(MAX_COPIED_EVENTS);
    expect(r.ok && r.truncated).toBe(true);
  });
});
