import { describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../fetch";
import { openFound, sealFound } from "./bundle";
import { findCalendars, isBrowserCheck, schoolSiteUrl } from "./finder";
import { calendarPages, decodeEntities, finalsiteFeeds, googleCalendarId, googleFeeds, outlookFeed, scanPage, siteOf } from "./scan";

/** Phase 51: the school calendar finder. Made-up schools and calendar ids only. */

const PAGE = new URL("https://www.lincoln-elementary.example/");
const urls = (html: string, page = PAGE) => scanPage(html, page).candidates.map((c) => c.url.toString());
const GOOGLE_ID = "lincoln-elementary.example_abc123@group.calendar.google.com";
const googleIcs = (id: string) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

describe("reading a page for calendars", () => {
  it("finds .ics, webcal, ?ical= and rel=alternate feeds, resolved against the page", () => {
    const html = `
      <link rel="alternate" type="text/calendar" title="Events" href="/events/?ical=1">
      <a href="calendar/district.ics">District calendar</a>
      <a href='webcal://feeds.lincoln-elementary.example/athletics.ics'>Athletics</a>
      <a href=//cdn.lincoln-elementary.example/lunch.ics>Lunch</a>
      <a href="/about">About us</a>`;
    expect(urls(html).sort()).toEqual(
      [
        "https://cdn.lincoln-elementary.example/lunch.ics",
        "https://feeds.lincoln-elementary.example/athletics.ics",
        "https://www.lincoln-elementary.example/calendar/district.ics",
        "https://www.lincoln-elementary.example/events/?ical=1",
      ].sort(),
    );
    const named = scanPage(html, PAGE).candidates.find((c) => c.url.pathname.endsWith("district.ics"));
    expect(named?.label).toBe("District calendar");
  });

  it("keeps resolving against the page when <base href> isn't https, and follows one that points elsewhere", () => {
    expect(urls(`<base href="http://insecure.example/"><a href="a.ics">a</a>`)).toEqual(["https://www.lincoln-elementary.example/a.ics"]);
    expect(urls(`<base href="https://cdn.lincoln-elementary.example/"><a href="a.ics">a</a>`)).toEqual(["https://cdn.lincoln-elementary.example/a.ics"]);
  });

  it("decodes entities and honours <base href>", () => {
    expect(decodeEntities("a&amp;b&#39;c&#x41;&nbsp;")).toBe("a&b'cA ");
    expect(urls(`<base href="https://www.lincoln-elementary.example/news/"><a href="feed.ics?x=1&amp;y=2">x</a>`)).toEqual([
      "https://www.lincoln-elementary.example/news/feed.ics?x=1&y=2",
    ]);
  });

  it("turns Google Calendar embeds and links into their public feeds, plain, encoded or base64", () => {
    const b64 = Buffer.from(GOOGLE_ID).toString("base64").replace(/=+$/, "");
    expect(googleCalendarId(GOOGLE_ID)).toBe(GOOGLE_ID);
    expect(googleCalendarId(b64)).toBe(GOOGLE_ID);
    expect(googleCalendarId("not an id")).toBeNull();
    const html = `
      <iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(GOOGLE_ID)}&amp;ctz=America%2FNew_York"></iframe>
      <iframe data-src="https://calendar.google.com/calendar/embed?src=${b64}&amp;src=en.usa%23holiday%40group.v.calendar.google.com"></iframe>`;
    expect(urls(html).sort()).toEqual([googleIcs("en.usa#holiday@group.v.calendar.google.com"), googleIcs(GOOGLE_ID)].sort());
    expect(googleFeeds(new URL("https://www.google.com/calendar/ical/x%40group.calendar.google.com/public/basic.ics"))).toHaveLength(1);
    expect(googleFeeds(new URL("https://evil.example/calendar/embed?src=x@y.z"))).toEqual([]);
  });

  it("finds an Outlook calendar's feed from its web link", () => {
    expect(outlookFeed(new URL("https://outlook.office365.com/owa/calendar/abc@lincoln-elementary.example/def/calendar.html"))?.pathname).toBe(
      "/owa/calendar/abc@lincoln-elementary.example/def/calendar.ics",
    );
    expect(outlookFeed(new URL("https://outlook.office365.com/mail/inbox"))).toBeNull();
  });

  it("finds Finalsite calendars by their ids, on the page's own site, unquoted values too", () => {
    expect(finalsiteFeeds("86,881", PAGE).map(String)).toEqual([
      "https://www.lincoln-elementary.example/fs/calendar-manager/events.ics?calendar_ids[]=86",
      "https://www.lincoln-elementary.example/fs/calendar-manager/events.ics?calendar_ids[]=881",
    ]);
    expect(urls(`<div class="fsElement fsCalendar" data-calendar-ids=86,881 data-x="y">`)).toHaveLength(2);
    expect(finalsiteFeeds("86; DROP", PAGE)).toHaveLength(1);
  });

  it("finds feed addresses written in onclick handlers and inline scripts", () => {
    const html = `
      <a href="#" onclick="SubscribeTo('https://www.lincoln-elementary.example/events/calendar.ics')">Subscribe</a>
      <script>var feed = "//www.lincoln-elementary.example/fs/feed.ics"; var typical = "musical";</script>`;
    expect(urls(html).sort()).toEqual(["https://www.lincoln-elementary.example/events/calendar.ics", "https://www.lincoln-elementary.example/fs/feed.ics"]);
  });

  it("ignores links that aren't https, and is fine with broken HTML", () => {
    expect(urls(`<a href="javascript:alert(1)">x.ics</a><a href="http://insecure.example/a.ics">a</a><a href="mailto:x@y.z">`)).toEqual([]);
    expect(() => scanPage(`<a href="unclosed.ics`, PAGE)).not.toThrow();
    expect(() => scanPage("<<<>>>< a <!-- never closed", PAGE)).not.toThrow();
  });

  it("stays linear on a big page", () => {
    const big = `<div class="x">${"<a href=\"/p\">news</a>".repeat(60_000)}</div>`;
    const t = Date.now();
    scanPage(big, PAGE);
    expect(Date.now() - t).toBeLessThan(2_000);
  });
});

describe("which pages to read next", () => {
  it("knows a site from its registrable part, roughly", () => {
    expect(siteOf("www.lincoln-elementary.example")).toBe("lincoln-elementary.example");
    expect(siteOf("lincoln.district.k12.ca.us")).toBe("district.k12.ca.us");
    expect(siteOf("www.school.co.uk")).toBe("school.co.uk");
  });

  it("picks up to 3 calendar-looking links on the same site, best first", () => {
    const { links } = scanPage(
      `<a href="/news">News</a><a href="/district-calendar">Calendar</a><a href="/events">Upcoming</a>
       <a href="https://other.example/calendar">Calendar</a><a href="/calendar.pdf">Calendar (PDF)</a>
       <a href="https://lincoln-elementary.example/subscribe">Subscribe</a><a href="/info">Events and more</a>`,
      PAGE,
    );
    expect(calendarPages(links, PAGE).map((u) => u.pathname)).toEqual(["/district-calendar", "/subscribe", "/info"]);
  });
});

// ---------- the whole finder, against a fake site ----------

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ics = (name: string | null, days = [5, 12, 20]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...(name ? [`X-WR-CALNAME:${name}`] : []),
    ...days.flatMap((d, i) => [
      "BEGIN:VEVENT",
      `UID:e${i}@lincoln-elementary.example`,
      `DTSTART;VALUE=DATE:202610${String(1 + d).padStart(2, "0")}`,
      `SUMMARY:Event ${i + 1}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");

const ok = (body: string, finalUrl?: URL): FetchResult => ({ status: "ok", body, etag: null, lastModified: null, finalUrl });

function site(pages: Record<string, FetchResult>, feeds: Record<string, FetchResult>) {
  const fetchPage = vi.fn(async (u: URL) => pages[u.toString()] ?? { status: "error" as const, reason: "x", httpStatus: 404 });
  const fetchFeed = vi.fn(async (u: URL) => feeds[u.toString()] ?? { status: "error" as const, reason: "x", httpStatus: 404 });
  return { fetchPage, fetchFeed, now: () => NOW, zone: "America/New_York" };
}

describe("findCalendars", () => {
  it("follows the home page to its calendar page, and lists the feed found there", async () => {
    const deps = site(
      {
        "https://www.lincoln-elementary.example/": ok(`<a href="/calendar">Calendar</a>`),
        "https://www.lincoln-elementary.example/calendar": ok(`<a href="/district.ics">Subscribe</a>`),
      },
      { "https://www.lincoln-elementary.example/district.ics": ok(ics("Lincoln Elementary")) },
    );
    const r = await findCalendars(PAGE, deps);
    expect(r.status).toBe("found");
    if (r.status !== "found") return;
    expect(r.calendars).toEqual([
      expect.objectContaining({ name: "Lincoln Elementary", host: "www.lincoln-elementary.example", upcoming: 3 }),
    ]);
    expect(r.calendars[0].next[0]).toContain("Event 1");
  });

  it("finds a Google embed and a Finalsite calendar, and drops a candidate that isn't a calendar", async () => {
    const deps = site(
      {
        "https://www.lincoln-elementary.example/": ok(
          `<iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(GOOGLE_ID)}"></iframe>
           <div data-calendar-ids="86"></div><a href="/broken.ics">Old feed</a>`,
        ),
      },
      {
        [googleIcs(GOOGLE_ID)]: ok(ics("Lincoln events")),
        "https://www.lincoln-elementary.example/fs/calendar-manager/events.ics?calendar_ids[]=86": ok(ics("District", [3])),
        "https://www.lincoln-elementary.example/broken.ics": { status: "error", reason: "That address didn't return a calendar feed." },
      },
    );
    const r = await findCalendars(PAGE, deps);
    expect(r.status === "found" && r.calendars.map((c) => c.name).sort()).toEqual(["District", "Lincoln events"]);
  });

  it("says so honestly when there's nothing, or when the site wants a browser", async () => {
    expect(await findCalendars(PAGE, site({ "https://www.lincoln-elementary.example/": ok("<p>Welcome</p>") }, {}))).toEqual({ status: "none" });
    expect(isBrowserCheck("<html><title>Client Challenge</title><noscript>JavaScript is disabled</noscript></html>")).toBe(true);
    const challenge = site({ "https://www.lincoln-elementary.example/": ok("<html><title>Client Challenge</title></html>") }, {});
    expect(await findCalendars(PAGE, challenge)).toEqual({ status: "blocked" });
    const refused = site({ "https://www.lincoln-elementary.example/": { status: "error", reason: "x", httpStatus: 403 } }, {});
    expect(await findCalendars(PAGE, refused)).toEqual({ status: "blocked" });
    // A page that only mentions a captcha form or has a noscript footer isn't a browser check.
    const news = "<p>Welcome back! Picture day is next week, and the book fair runs all week in the library. Lunch menus are posted on the cafeteria page.</p>".repeat(3);
    expect(isBrowserCheck(`<title>Lincoln Elementary</title>${news}<form class="g-recaptcha"></form><noscript>Please enable JavaScript to view the comments</noscript>`)).toBe(false);
    // A browser-check page with a feed link on it still offers the feed.
    const withFeed = site(
      { "https://www.lincoln-elementary.example/": ok(`<title>Just a moment</title><a href="/district.ics">Calendar</a>`) },
      { "https://www.lincoln-elementary.example/district.ics": ok(ics("Lincoln Elementary")) },
    );
    expect((await findCalendars(PAGE, withFeed)).status).toBe("found");
    const gone = site({ "https://www.lincoln-elementary.example/": { status: "error", reason: "Couldn't reach the feed." } }, {});
    expect(await findCalendars(PAGE, gone)).toEqual({ status: "error", reason: "Couldn't reach the feed." });
  });

  it("doesn't read a calendar page that redirected off the school's site", async () => {
    const deps = site(
      {
        "https://www.lincoln-elementary.example/": ok(`<a href="/calendar">Calendar</a>`),
        "https://www.lincoln-elementary.example/calendar": ok(`<a href="/x.ics">x</a>`, new URL("https://elsewhere.example/calendar")),
      },
      { "https://elsewhere.example/x.ics": ok(ics("Elsewhere")) },
    );
    expect(await findCalendars(PAGE, deps)).toEqual({ status: "none" });
  });

  it("keeps to its limits: 4 pages and 8 feeds", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `<a href="/f${i}.ics">Feed ${i}</a><a href="/calendar-${i}">Calendar ${i}</a>`).join("");
    const deps = site({ "https://www.lincoln-elementary.example/": ok(many) }, {});
    await findCalendars(PAGE, deps);
    expect(deps.fetchPage).toHaveBeenCalledTimes(4);
    expect(deps.fetchFeed).toHaveBeenCalledTimes(8);
  });

  it("reads a school's address typed as a bare host", () => {
    expect(schoolSiteUrl("lincoln-elementary.example")?.toString()).toBe("https://lincoln-elementary.example/");
    expect(schoolSiteUrl("http://lincoln-elementary.example")).toBeNull();
    expect(schoolSiteUrl("localhost")).toBeNull();
    expect(schoolSiteUrl("")).toBeNull();
  });
});

describe("the sealed list of what was found", () => {
  const who = { householdId: "h1", personId: "dad" };
  const entries = [
    { url: "https://www.lincoln-elementary.example/a.ics?token=secret", name: "A" },
    { url: "https://www.lincoln-elementary.example/b.ics", name: "B" },
  ];

  it("opens for the same admin, with the chosen entry, and never shows the address", () => {
    const sealed = sealFound(entries, who, NOW);
    expect(sealed).not.toContain("lincoln");
    expect(sealed).not.toContain("secret");
    expect(openFound(sealed, 1, who, NOW + 60_000)).toEqual(entries[1]);
  });

  it("doesn't open for anyone else, after 15 minutes, changed, or out of range", () => {
    const sealed = sealFound(entries, who, NOW);
    expect(openFound(sealed, 0, { householdId: "h1", personId: "mom" }, NOW)).toBeNull();
    expect(openFound(sealed, 0, { householdId: "h2", personId: "dad" }, NOW)).toBeNull();
    expect(openFound(sealed, 0, who, NOW + 16 * 60_000)).toBeNull();
    expect(openFound(sealed.slice(0, -2) + "AA", 0, who, NOW)).toBeNull();
    expect(openFound(sealed, 5, who, NOW)).toBeNull();
    expect(openFound(sealed, -1, who, NOW)).toBeNull();
    expect(openFound("garbage", 0, who, NOW)).toBeNull();
  });
});
