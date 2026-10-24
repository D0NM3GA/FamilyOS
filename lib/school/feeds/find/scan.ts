/**
 * Phase 51: reads a school web page for calendar feeds, without running it. One linear pass over
 * the HTML (tags, attribute values quoted or not, entities decoded, links resolved against the
 * page or its `<base href>`), collecting:
 * - feed addresses: `.ics`, `?ical=…`, `webcal://`, `<link rel="alternate" type="text/calendar">`;
 * - Google Calendar embeds and links, each calendar id turned into its public feed;
 * - Outlook published calendars (`calendar.html` has a matching `calendar.ics`);
 * - Finalsite calendars, named by `data-calendar-ids` (its Subscribe button is built by a script);
 * - feed addresses written inside `onclick` handlers and inline scripts;
 * - links that look like a calendar page, to read next (lib/school/feeds/find/finder.ts).
 * Pure: no fetching here. Every regex runs on one short attribute or a bounded window.
 */

export type Candidate = { url: URL; label: string | null };
export type PageLink = { url: URL; text: string };
export type ScanResult = { candidates: Candidate[]; links: PageLink[] };

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

type Tag = { name: string; attrs: Map<string, string>; end: number };

/** Reads one tag starting at `<`; returns null if it isn't one. Linear in the tag's length. */
function readTag(html: string, start: number): Tag | null {
  let i = start + 1;
  const closing = html[i] === "/";
  if (closing) i++;
  const nameStart = i;
  while (i < html.length && /[A-Za-z0-9:-]/.test(html[i])) i++;
  if (i === nameStart) return null;
  const name = (closing ? "/" : "") + html.slice(nameStart, i).toLowerCase();
  const attrs = new Map<string, string>();
  while (i < html.length && html[i] !== ">") {
    while (i < html.length && /[\s/]/.test(html[i])) i++;
    if (html[i] === ">") break;
    const keyStart = i;
    while (i < html.length && !/[\s=>/]/.test(html[i])) i++;
    const key = html.slice(keyStart, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? html.length : close;
        value = html.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i++;
        value = html.slice(valueStart, i);
      }
    }
    if (key && !attrs.has(key)) attrs.set(key, decodeEntities(value));
    if (i === keyStart) i++;
  }
  return { name, attrs, end: i + 1 };
}

/** A link resolved against the page (relative, protocol-relative, webcal), https only. */
export function resolveLink(raw: string, base: URL): URL | null {
  const text = raw.trim().replace(/^webcals?:\/\//i, "https://");
  if (!text || /^(javascript|mailto|tel|data):/i.test(text)) return null;
  try {
    const url = new URL(text, base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** A feed address by its look: `.ics`, `?ical=…` (WordPress's The Events Calendar), or from webcal. */
function looksLikeFeed(raw: string, url: URL): boolean {
  return /^webcals?:/i.test(raw.trim()) || /\.ics$/i.test(url.pathname) || url.searchParams.has("ical") || /\/ical\//i.test(url.pathname);
}

/** A Google calendar id from an embed's `src` or a link's `cid`: plain, %-encoded, or base64. */
export function googleCalendarId(value: string): string | null {
  const plain = value.trim();
  if (/^[^\s/]+@[a-z0-9.-]+$/i.test(plain)) return plain;
  if (/^[A-Za-z0-9+/_-]{8,400}={0,2}$/.test(plain)) {
    const decoded = Buffer.from(plain.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (/^[^\s/]+@[a-z0-9.-]+$/i.test(decoded)) return decoded;
  }
  return null;
}

const googleFeed = (id: string) => new URL(`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`);

/** The public feeds behind a Google Calendar embed or link; empty for anything else. */
export function googleFeeds(url: URL): URL[] {
  const host = url.hostname.toLowerCase();
  if (host !== "calendar.google.com" && host !== "www.google.com") return [];
  if (!url.pathname.startsWith("/calendar")) return [];
  if (/\/calendar\/ical\//.test(url.pathname)) return [url];
  const ids = [...url.searchParams.getAll("src"), ...url.searchParams.getAll("cid")].map(googleCalendarId).filter((id): id is string => Boolean(id));
  return [...new Set(ids)].map(googleFeed);
}

/** An Outlook published calendar's feed: its `….html` link has a matching `….ics`. */
export function outlookFeed(url: URL): URL | null {
  const host = url.hostname.toLowerCase();
  if (!/^outlook\.(office365|office|live)\.com$/.test(host) || !/\/owa\/calendar\//i.test(url.pathname)) return null;
  if (/\.ics$/i.test(url.pathname)) return url;
  if (!/\.html$/i.test(url.pathname)) return null;
  const feed = new URL(url);
  feed.pathname = url.pathname.replace(/\.html$/i, ".ics");
  return feed;
}

/** Finalsite: each id in `data-calendar-ids` is a feed on the same site. */
export function finalsiteFeeds(value: string, page: URL): URL[] {
  const ids = [...new Set(value.match(/\d{1,9}/g) ?? [])].slice(0, 8);
  return ids.map((id) => new URL(`/fs/calendar-manager/events.ics?calendar_ids[]=${id}`, page.origin));
}

/** Feed addresses written in a script or an onclick handler (bounded, no backtracking). */
function addressesInScript(text: string): string[] {
  if (!/\.ics|ical/i.test(text)) return [];
  return text.match(/(?:https?:|webcals?:)?\/\/[^\s"'<>\\]{3,400}?(?:\.ics|[?&]ical=[^\s"'<>\\&]{0,40})/gi) ?? [];
}

const CALENDAR_WORDS = /calendar|events|ical|subscribe/i;
const ATTRS_WITH_LINKS = ["href", "src", "data-src", "data-href", "data-url", "data-feed", "data-ical"];

export function scanPage(html: string, page: URL): ScanResult {
  let base = page;
  const found = new Map<string, Candidate>();
  const links: PageLink[] = [];
  const add = (url: URL | null, label: string | null) => {
    if (!url) return;
    const key = url.toString();
    if (!found.has(key) || (!found.get(key)!.label && label)) found.set(key, { url, label });
  };
  const fromAddress = (raw: string, label: string | null) => {
    const url = resolveLink(raw, base);
    if (!url) return;
    const google = googleFeeds(url);
    if (google.length) return google.forEach((g) => add(g, label));
    const outlook = outlookFeed(url);
    if (outlook) return add(outlook, label);
    if (looksLikeFeed(raw, url)) add(url, label);
  };

  const lower = html.toLowerCase();
  let openLink: { url: URL | null; textStart: number } | null = null;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const tag = readTag(html, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const a = tag.attrs;
    if (tag.name === "base" && a.get("href")) {
      const next = resolveLink(a.get("href")!, page);
      if (next) base = next;
    }
    if (tag.name === "link" && /alternate/i.test(a.get("rel") ?? "") && /text\/calendar/i.test(a.get("type") ?? "") && a.get("href")) {
      add(resolveLink(a.get("href")!, base), a.get("title") ?? null);
    }
    for (const key of ATTRS_WITH_LINKS) {
      const value = a.get(key);
      if (value) fromAddress(value, a.get("title") ?? a.get("aria-label") ?? null);
    }
    if (a.get("data-calendar-ids")) finalsiteFeeds(a.get("data-calendar-ids")!, page).forEach((u) => add(u, null));
    const onclick = a.get("onclick");
    if (onclick) addressesInScript(onclick).forEach((raw) => fromAddress(raw, null));
    if (tag.name === "a") openLink = { url: a.get("href") ? resolveLink(a.get("href")!, base) : null, textStart: i };
    if (tag.name === "/a" && openLink) {
      const text = decodeEntities(html.slice(openLink.textStart, Math.min(lt, openLink.textStart + 400)).replace(/<[^>]{0,400}>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (openLink.url) {
        links.push({ url: openLink.url, text });
        // A feed link's own words name it ("Athletics calendar").
        const key = openLink.url.toString();
        if (found.has(key) && !found.get(key)!.label && text) found.set(key, { url: openLink.url, label: text.slice(0, 80) });
      }
      openLink = null;
    }
    if (tag.name === "script") {
      const close = lower.indexOf("</script", i);
      const stop = close === -1 ? html.length : close;
      addressesInScript(html.slice(i, Math.min(stop, i + 200_000))).forEach((raw) => fromAddress(raw, null));
      i = stop;
    }
  }
  return { candidates: [...found.values()], links };
}

/**
 * The part of a host that names the site: the last two labels, three for a two-letter country's
 * second level (co.uk, com.au), four under a US state's k12 (district.k12.ca.us). An
 * approximation of the public suffix list, enough to keep the finder on the school's own site.
 */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length >= 4 && labels.at(-1) === "us" && labels.at(-3) === "k12") return labels.slice(-4).join(".");
  if (labels.length >= 3 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Up to `max` links on the same site that look like a calendar page, best first. */
export function calendarPages(links: PageLink[], page: URL, max = 3): URL[] {
  const site = siteOf(page.hostname);
  const seen = new Set([page.toString()]);
  const scored: { url: URL; score: number; order: number }[] = [];
  links.forEach((l, order) => {
    if (siteOf(l.url.hostname) !== site || /\.(pdf|docx?|xlsx?|jpe?g|png|gif|zip|ics)$/i.test(l.url.pathname)) return;
    const key = l.url.toString();
    if (seen.has(key)) return;
    const score = (CALENDAR_WORDS.test(l.text) ? 2 : 0) + (CALENDAR_WORDS.test(l.url.pathname + l.url.search) ? 1 : 0);
    if (score === 0) return;
    seen.add(key);
    scored.push({ url: l.url, score, order });
  });
  return scored
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, max)
    .map((s) => s.url);
}
