import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { PRODUCT_NAME } from "@/lib/app-name";
import { isBlockedAddress, literalAddress } from "./url";

/**
 * Fetches a school calendar feed with an SSRF guard (Phase 18.5; Fable's scope reviews).
 * The URL comes from an admin, but the server must still never be pointed at itself or the
 * home network:
 * - Every resolved address is checked, and the checked address is the one the socket
 *   connects to (a custom `lookup`), so a DNS answer can't change between check and connect.
 * - IP-literal hosts skip DNS entirely, so they're checked up front.
 * - Redirects are followed by hand (at most 3), each through the same guard, https only.
 * - 10 s overall, 2 MB cap, and the body must be an iCalendar file.
 * Errors are fixed text: never the URL or hostname, since feed URLs often carry a secret
 * token (sometimes in the path) and error text can reach logs and Sentry.
 */

export type FetchResult =
  | { status: "ok"; body: string; etag: string | null; lastModified: string | null; finalUrl?: URL }
  | { status: "unchanged" }
  /** `httpStatus`: the server's own refusal (Phase 51 tells a blocked site from a missing one). */
  | { status: "error"; reason: string; httpStatus?: number };

/**
 * Phase 51: what's fetched. A feed (the default) must be an iCalendar file; a page (the school's
 * own website, read by the calendar finder) must be HTML. The guard is the same for both.
 */
export type FetchKind = { accept: string; wanted: (body: string) => boolean; notWanted: string; timeoutMs: number };

export const PAGE_KIND: FetchKind = {
  accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.5",
  wanted: (body) => /<(!doctype html|html|head|body|a\s|div|link)\b/i.test(body.slice(0, 65_536)),
  notWanted: "That address isn't a web page.",
  timeoutMs: 10_000,
};

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = `${PRODUCT_NAME} family calendar (school feed)`;

export const FEED_ERRORS = {
  blocked: "That address points at a private or local network, so the app won't fetch it.",
  unreachable: "Couldn't reach the feed. Check the address, or try again later.",
  status: "The feed's server said no (it may need a new link).",
  tooLarge: "The feed is too large.",
  notCalendar: "That address didn't return a calendar feed.",
  redirects: "The feed redirected too many times.",
  timeout: "The feed took too long to answer.",
};

export const FEED_KIND: FetchKind = {
  accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
  wanted: (body) => /^\s*BEGIN:VCALENDAR/i.test(body),
  notWanted: FEED_ERRORS.notCalendar,
  timeoutMs: 10_000,
};

type Resolve = (host: string, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void;

const systemResolve: Resolve = (host, cb) => dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => cb(err, addresses ?? []));

class GuardError extends Error {}

/** A `lookup` for https.request that rejects the whole request if any address is blocked. */
export function guardedLookup(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (err, addresses) => {
      if (err || addresses.length === 0) return callback(err ?? new Error("no addresses"), "", 4);
      if (addresses.some((a) => isBlockedAddress(a.address))) return callback(new GuardError("blocked"), "", 4);
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/** Where a redirect goes, resolved against the current URL; null if it isn't https. */
export function nextLocation(current: URL, location: string | undefined): URL | null {
  if (!location) return null;
  try {
    const next = new URL(location, current);
    return next.protocol === "https:" ? next : null;
  } catch {
    return null;
  }
}

type Conditional = { etag?: string | null; lastModified?: string | null };

function once(url: URL, conditional: Conditional, resolve: Resolve, deadline: number, kind: FetchKind): Promise<
  | { kind: "redirect"; location: string | undefined }
  | { kind: "done"; result: FetchResult }
> {
  return new Promise((resolvePromise) => {
    // The socket's own timeout only fires when the line goes quiet; a server trickling a
    // byte every few seconds would never trip it. This timer is the real 10 s cap.
    const deadlineTimer: { id?: ReturnType<typeof setTimeout> } = {};
    const done = (value: Parameters<typeof resolvePromise>[0]) => {
      if (deadlineTimer.id) clearTimeout(deadlineTimer.id);
      resolvePromise(value);
    };
    const literal = literalAddress(url);
    if (literal && isBlockedAddress(literal)) return done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.blocked } });
    const remaining = deadline - Date.now();
    if (remaining <= 0) return done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.timeout } });

    const req = request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(resolve),
        timeout: remaining,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: kind.accept,
          "Accept-Encoding": "identity",
          ...(conditional.etag ? { "If-None-Match": conditional.etag } : {}),
          ...(conditional.lastModified ? { "If-Modified-Since": conditional.lastModified } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && status !== 304) {
          res.resume();
          return done({ kind: "redirect", location: res.headers.location });
        }
        if (status === 304) {
          res.resume();
          return done({ kind: "done", result: { status: "unchanged" } });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.status, httpStatus: status } });
        }
        // Asked for no compression; a server that compresses anyway isn't decoded (the
        // 2 MB cap would then be meaningless), and gets an honest message.
        const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
        if (encoding !== "identity") {
          res.resume();
          return done({ kind: "done", result: { status: "error", reason: kind.notWanted } });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            return done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.tooLarge } });
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
          if (!kind.wanted(body)) return done({ kind: "done", result: { status: "error", reason: kind.notWanted } });
          done({
            kind: "done",
            result: {
              status: "ok",
              body,
              etag: typeof res.headers.etag === "string" ? res.headers.etag : null,
              lastModified: typeof res.headers["last-modified"] === "string" ? res.headers["last-modified"] : null,
              finalUrl: url,
            },
          });
        });
        res.on("error", () => done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.unreachable } }));
      },
    );
    const giveUp = () => {
      req.destroy();
      done({ kind: "done", result: { status: "error", reason: FEED_ERRORS.timeout } });
    };
    req.on("timeout", giveUp);
    deadlineTimer.id = setTimeout(giveUp, remaining);
    // The raw error can name the host (getaddrinfo, TLS): only its kind is kept.
    req.on("error", (err) => done({ kind: "done", result: { status: "error", reason: err instanceof GuardError ? FEED_ERRORS.blocked : FEED_ERRORS.unreachable } }));
    req.end();
  });
}

export async function fetchFeed(url: URL, conditional: Conditional = {}, deps: { resolve?: Resolve; kind?: FetchKind } = {}): Promise<FetchResult> {
  const resolve = deps.resolve ?? systemResolve;
  const kind = deps.kind ?? FEED_KIND;
  const deadline = Date.now() + kind.timeoutMs;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const outcome = await once(current, conditional, resolve, deadline, kind);
    if (outcome.kind === "done") return outcome.result;
    const next = nextLocation(current, outcome.location);
    if (!next) return { status: "error", reason: FEED_ERRORS.unreachable };
    current = next;
  }
  return { status: "error", reason: FEED_ERRORS.redirects };
}
