import { fetchFeed, PAGE_KIND, type FetchResult } from "../fetch";
import { expandFeed } from "../parse";
import { formatEventWhen } from "@/lib/format";
import { calendarPages, scanPage, siteOf, type Candidate } from "./scan";

/**
 * Phase 51: finds a school's calendar feeds from its web address (docs/PLAN.md, Phase 51). Reads
 * the page and up to 3 calendar-looking pages on the same site, then tries each feed address found
 * (at most 8) and keeps the ones the app can read. Every fetch goes through the Phase 18.5 guard
 * (lib/school/feeds/fetch.ts). Errors are fixed text and never name an address.
 */

export type FoundCalendar = {
  url: URL;
  name: string;
  host: string;
  upcoming: number;
  next: string[];
};

export type FindResult =
  | { status: "found"; calendars: FoundCalendar[] }
  | { status: "none" }
  /** The site answers a plain fetch with a browser check or a refusal. */
  | { status: "blocked" }
  | { status: "error"; reason: string };

export type FindDeps = {
  fetchPage?: (url: URL) => Promise<FetchResult>;
  fetchFeed?: (url: URL) => Promise<FetchResult>;
  now?: () => number;
  /** The household's zone, for the events' times. */
  zone: string;
};

const MAX_PAGES = 4;
const MAX_FEEDS = 8;
const MAX_FETCHES = 12;
const BUDGET_MS = 30_000;
const WINDOW_DAYS = 120;

export const FINDER_ERRORS = {
  address: "That doesn't look like a web address. Try the school's address, like lincoln-elementary.example.",
};

/** What someone types for the school's site: a bare host or a full https address. */
export function schoolSiteUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text || text.length > 500) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/**
 * A page that's only a browser check (a bot challenge) or a "turn on JavaScript" notice: small,
 * saying so near the top, and with few links. A normal page that merely mentions a captcha form
 * or has a noscript footer isn't one (Fable's implementation review).
 */
export function isBrowserCheck(body: string): boolean {
  if (body.length > 20_000) return false;
  const title = /<title[^>]{0,100}>([^<]{0,200})/i.exec(body)?.[1] ?? "";
  if (/client challenge|just a moment|checking your browser|attention required|verify you are human/i.test(title)) return true;
  // Otherwise only a page that's next to nothing but that notice.
  const text = body
    .replace(/<(script|style)[\s\S]{0,20000}?<\/\1>/gi, " ")
    .replace(/<[^>]{0,2000}>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 300 && /enable javascript|javascript is (disabled|required)/i.test(text);
}

const refused = (r: FetchResult) => r.status === "error" && (r.httpStatus === 403 || r.httpStatus === 429 || r.httpStatus === 503);

/** The feed's own name, from its first few kilobytes (iCalendar folds long lines; unfolded first). */
function calendarName(body: string): string | null {
  const head = body.slice(0, 8_192).replace(/\r?\n[ \t]/g, "");
  const m = /^X-WR-CALNAME:(.{1,120})$/im.exec(head);
  return m ? m[1].trim().replace(/\\([,;\\])/g, "$1") : null;
}

export async function findCalendars(site: URL, deps: FindDeps): Promise<FindResult> {
  const now = deps.now ?? Date.now;
  const getPage = deps.fetchPage ?? ((url: URL) => fetchFeed(url, {}, { kind: PAGE_KIND }));
  const getFeed = deps.fetchFeed ?? ((url: URL) => fetchFeed(url));
  const deadline = now() + BUDGET_MS;
  let fetches = 0;
  const canFetch = () => fetches < MAX_FETCHES && now() < deadline;

  const first = await getPage(site);
  fetches++;
  if (first.status === "error") return refused(first) ? { status: "blocked" } : { status: "error", reason: first.reason };
  if (first.status !== "ok") return { status: "none" };

  const home = first.finalUrl ?? site;
  const homeSite = siteOf(home.hostname);
  const candidates = new Map<string, Candidate>();
  const take = (list: Candidate[]) => {
    for (const c of list) {
      const key = c.url.toString();
      if (!candidates.has(key) || (!candidates.get(key)!.label && c.label)) candidates.set(key, c);
    }
  };
  const scanned = scanPage(first.body, home);
  take(scanned.candidates);

  // Scanned all the same: a feed link on it still counts, and "blocked" is only the answer
  // when nothing readable turns up.
  let blockedPages = isBrowserCheck(first.body) ? 1 : 0;
  for (const page of calendarPages(scanned.links, home, MAX_PAGES - 1)) {
    if (!canFetch()) break;
    const r = await getPage(page);
    fetches++;
    if (r.status !== "ok") {
      if (refused(r)) blockedPages++;
      continue;
    }
    // A redirect off the school's site isn't the school's page.
    const at = r.finalUrl ?? page;
    if (siteOf(at.hostname) !== homeSite) continue;
    if (isBrowserCheck(r.body)) {
      blockedPages++;
      continue;
    }
    take(scanPage(r.body, at).candidates);
  }

  const calendars: FoundCalendar[] = [];
  const window = { from: new Date(now() - 7 * 86_400_000), to: new Date(now() + WINDOW_DAYS * 86_400_000) };
  for (const c of [...candidates.values()].slice(0, MAX_FEEDS)) {
    if (!canFetch()) break;
    const r = await getFeed(c.url);
    fetches++;
    if (r.status !== "ok") continue;
    try {
      const { events } = expandFeed(r.body, { ...window, fallbackZone: deps.zone });
      const ahead = events.filter((e) => e.endsAt.getTime() >= now()).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
      calendars.push({
        url: c.url,
        name: (calendarName(r.body) ?? c.label ?? c.url.hostname).slice(0, 80),
        host: c.url.hostname,
        upcoming: ahead.length,
        next: ahead.slice(0, 3).map((e) => `${formatEventWhen(e, deps.zone)} · ${e.title}`.slice(0, 120)),
      });
    } catch {
      // Not a calendar the app can read: not offered.
    }
  }
  if (calendars.length) return { status: "found", calendars };
  return blockedPages > 0 ? { status: "blocked" } : { status: "none" };
}

