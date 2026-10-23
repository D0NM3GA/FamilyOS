import { describe, expect, it } from "vitest";
import { FEED_ERRORS, fetchFeed, nextLocation } from "./fetch";
import { expandFeed, wallClockToInstant } from "./parse";
import { feedUrlHash, isBlockedAddress, normalizeFeedUrl } from "./url";

const cal = (body: string, extra = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${extra}${body}END:VCALENDAR\r\n`;
const WINDOW = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z"), fallbackZone: "America/New_York" };

describe("normalizeFeedUrl", () => {
  it("turns webcal into https and refuses anything else", () => {
    const r = normalizeFeedUrl("  webcal://school.example.org/cal.ics#x ");
    expect(r.ok && r.url.toString()).toBe("https://school.example.org/cal.ics");
    expect(normalizeFeedUrl("webcals://a.example/c.ics").ok).toBe(true);
    expect(normalizeFeedUrl("http://a.example/c.ics").ok).toBe(false);
    expect(normalizeFeedUrl("https://user:pw@a.example/c.ics").ok).toBe(false);
    expect(normalizeFeedUrl("not a url").ok).toBe(false);
  });
  it("hashes the normalised URL, so webcal and https forms are one feed", () => {
    const a = normalizeFeedUrl("webcal://a.example/c.ics");
    const b = normalizeFeedUrl("https://a.example/c.ics");
    expect(a.ok && b.ok && feedUrlHash(a.url) === feedUrlHash(b.url)).toBe(true);
  });
});

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.20.30.40", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "64:ff9b::a00:1", "2002:a00:1::", "not-an-ip"])(
    "blocks %s",
    (a) => expect(isBlockedAddress(a)).toBe(true),
  );
  it.each(["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe("fetchFeed guard", () => {
  it("refuses IP-literal hosts on private networks without connecting", async () => {
    for (const u of ["https://127.0.0.1/cal.ics", "https://[::1]/cal.ics", "https://10.20.30.40/cal.ics"]) {
      expect(await fetchFeed(new URL(u))).toEqual({ status: "error", reason: FEED_ERRORS.blocked });
    }
  });
  it("refuses a hostname that resolves to a private address (any of them)", async () => {
    const resolve = (_h: string, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]);
    expect(await fetchFeed(new URL("https://feeds.example/cal.ics"), {}, { resolve })).toEqual({ status: "error", reason: FEED_ERRORS.blocked });
  });
  it("follows only https redirects, resolved against the current URL", () => {
    const base = new URL("https://a.example/x/cal.ics");
    expect(nextLocation(base, "/y/cal.ics")?.toString()).toBe("https://a.example/y/cal.ics");
    expect(nextLocation(base, "http://a.example/cal.ics")).toBeNull();
    expect(nextLocation(base, undefined)).toBeNull();
  });
});

describe("wallClockToInstant", () => {
  it("converts local wall clock in a zone, across DST", () => {
    expect(wallClockToInstant(2026, 7, 1, 9, 0, 0, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z"); // EDT
    expect(wallClockToInstant(2026, 12, 1, 9, 0, 0, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z"); // EST
  });
});

describe("expandFeed", () => {
  it("an all-day multi-day event is stored as UTC dates, end exclusive", () => {
    const { events } = expandFeed(
      cal("BEGIN:VEVENT\r\nUID:fall-break\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261015\r\nSUMMARY:Fall break\r\nEND:VEVENT\r\n"),
      WINDOW,
    );
    expect(events).toEqual([
      expect.objectContaining({ title: "Fall break", allDay: true, startsAt: new Date("2026-10-12T00:00:00Z"), endsAt: new Date("2026-10-15T00:00:00Z") }),
    ]);
  });

  it("expands a weekly rule inside the window, skipping EXDATEs, applying an override and a cancellation", () => {
    const ics = cal(
      [
        "BEGIN:VEVENT",
        "UID:club",
        "DTSTART:20260902T200000Z",
        "DTEND:20260902T210000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=WE",
        "EXDATE:20260916T200000Z",
        "SUMMARY:Chess club",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:club",
        "RECURRENCE-ID:20260923T200000Z",
        "DTSTART:20260924T200000Z",
        "DTEND:20260924T210000Z",
        "SUMMARY:Chess club (moved)",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:club",
        "RECURRENCE-ID:20260930T200000Z",
        "DTSTART:20260930T200000Z",
        "DTEND:20260930T210000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Chess club",
        "END:VEVENT",
        "",
      ].join("\r\n"),
    );
    const { events } = expandFeed(ics, { ...WINDOW, to: new Date("2026-10-08T00:00:00Z") });
    expect(events.map((e) => [e.startsAt.toISOString().slice(0, 10), e.title])).toEqual([
      ["2026-09-02", "Chess club"],
      ["2026-09-09", "Chess club"],
      ["2026-09-24", "Chess club (moved)"],
      ["2026-10-07", "Chess club"],
    ]);
  });

  it("a TZID the feed never defines is still converted in that zone, per occurrence", () => {
    const { events } = expandFeed(
      cal("BEGIN:VEVENT\r\nUID:pto\r\nDTSTART;TZID=America/New_York:20261005T180000\r\nDTEND;TZID=America/New_York:20261005T190000\r\nSUMMARY:PTO meeting\r\nEND:VEVENT\r\n"),
      WINDOW,
    );
    expect(events[0].startsAt.toISOString()).toBe("2026-10-05T22:00:00.000Z");
  });

  it("floating times use the household's zone", () => {
    const { events } = expandFeed(cal("BEGIN:VEVENT\r\nUID:f\r\nDTSTART:20261005T090000\r\nDURATION:PT1H\r\nSUMMARY:Picture day\r\nEND:VEVENT\r\n"), WINDOW);
    expect(events[0]).toMatchObject({ startsAt: new Date("2026-10-05T13:00:00Z"), endsAt: new Date("2026-10-05T14:00:00Z"), allDay: false });
  });

  it("an old daily rule reaches the window without spinning forever", () => {
    const { events, truncated } = expandFeed(
      cal("BEGIN:VEVENT\r\nUID:d\r\nDTSTART;VALUE=DATE:20150101\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Daily\r\nEND:VEVENT\r\n"),
      { ...WINDOW, to: new Date("2026-09-03T00:00:00Z") },
    );
    expect(truncated).toBe(false);
    expect(events.map((e) => e.startsAt.toISOString().slice(0, 10))).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"].filter((d) => d >= "2026-09-01"));
  });

  it("keeps every day of an event whose days share one UID, and all-day events with DTEND = DTSTART", () => {
    const day = (d: string) => `BEGIN:VEVENT\r\nUID:camp\r\nDTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${d}\r\nSUMMARY:Camp\r\nEND:VEVENT\r\n`;
    const { events } = expandFeed(cal(day("20261005") + day("20261006") + day("20261007")), WINDOW);
    expect(events.map((e) => [e.startsAt.toISOString().slice(0, 10), e.endsAt.toISOString().slice(0, 10)])).toEqual([
      ["2026-10-05", "2026-10-06"],
      ["2026-10-06", "2026-10-07"],
      ["2026-10-07", "2026-10-08"],
    ]);
  });

  it("drops control characters from titles", () => {
    const { events } = expandFeed(cal("BEGIN:VEVENT\r\nUID:n\r\nDTSTART;VALUE=DATE:20261001\r\nSUMMARY:Bad\u0000Title\r\nEND:VEVENT\r\n"), WINDOW);
    expect(events[0].title).toBe("BadTitle");
  });

  it("one broken series doesn't sink the feed", () => {
    const { events } = expandFeed(
      cal(
        "BEGIN:VEVENT\r\nUID:bad\r\nDTSTART:garbage\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Bad\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:ok\r\nDTSTART;VALUE=DATE:20261001\r\nSUMMARY:Good\r\nEND:VEVENT\r\n",
      ),
      WINDOW,
    );
    expect(events.map((e) => e.title)).toContain("Good");
  });
});
