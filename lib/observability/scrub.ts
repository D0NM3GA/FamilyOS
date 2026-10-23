/**
 * What may leave the house (Phase 15). The owner's rule: no personal data reaches Sentry — no
 * names, emails, phone numbers, health or location data, cookies, or request bodies.
 * Users are identified only by an opaque Person id.
 *
 * `dataCollection` (see ./options.ts) is the first line of defense; this module is the
 * second, for the paths Fable's scope review found that `dataCollection` does NOT cover in
 * @sentry/nextjs 11.0.0 (verified against the package source):
 * - `contexts.nextjs.request_path` keeps the raw query string (e.g. `/search?q=<name>`).
 * - Browser events set `request.url = location.href` and a `Referer` header.
 * - URL *paths* are never filtered: the NWS client puts the household's latitude/longitude
 *   in the path (`/points/41.8781,-87.6298`).
 * - Exception messages can embed data: Graph errors carried `$filter=...email...`, and
 *   PrismaClientValidationError messages print the call arguments (actual field values).
 * - Console breadcrumbs keep the raw logged objects. The integration is removed in every
 *   runtime (./options.ts); dropping them here too is defense in depth.
 * - Browser click/input breadcrumbs and web-vital spans describe the element as a CSS
 *   selector that always includes its aria-label/title/alt/name attributes — and avatar
 *   stacks label people by name (found by Fable's implementation review).
 *
 * Pure functions only — no Sentry import, no side effects — so they're unit-tested
 * directly and the same code runs on server, edge and client.
 */

// Just enough structure of Sentry's event/breadcrumb/span payloads to scrub them; kept
// local (not imported from @sentry/*) so this stays a dependency-free pure module. The
// options module passes Sentry's real objects straight through these.
type Dict = Record<string, unknown>;

export type ScrubbableBreadcrumb = { category?: string; message?: string; data?: Dict };

export type ScrubbableEvent = {
  message?: string;
  transaction?: string;
  request?: { url?: string; query_string?: unknown; cookies?: unknown; data?: unknown; headers?: Record<string, string> };
  user?: { id?: string | number } & Dict;
  contexts?: Record<string, Dict | undefined>;
  breadcrumbs?: ScrubbableBreadcrumb[];
  exception?: { values?: { type?: string; value?: string }[] };
};

export type ScrubbableSpan = { name: string; attributes: Dict };

/** Request headers that carry no personal data; everything else is dropped. */
export const ALLOWED_REQUEST_HEADERS = ["content-type", "accept", "accept-language"];

/** Drops everything from the first `?` or `#` — query strings and fragments. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

// A latitude,longitude pair anywhere in a string (NWS: /points/41.8781,-87.6298), and an
// NWS forecast grid cell (/gridpoints/LOT/76,73), which localizes to ~2.5 km just the same.
const COORDINATES = /-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/g;
const NWS_GRIDPOINT = /gridpoints\/[A-Z]{3}\/\d+,\d+/g;

export function redactCoordinates(text: string): string {
  return text.replace(COORDINATES, "[coords]").replace(NWS_GRIDPOINT, "gridpoints/[coords]");
}

// Phase 40.2b: an invite's token is a path segment (/invite/<token>) and a live credential for
// 48 hours, so it goes wherever a URL or a message mentions it (Fable's review).
const INVITE_TOKEN = /\/invite\/[^/?#\s'"]+/g;

export function redactPathSecrets(text: string): string {
  return text.replace(INVITE_TOKEN, "/invite/[token]");
}

// The attributes the browser SDK always writes into an element selector.
const SELECTOR_LABEL_ATTRIBUTES = /\[(aria-label|title|alt|name)="[^"]*"\]/g;

/** div[aria-label="Ada Lovelace"] -> div[aria-label] — keeps the element, drops the label. */
export function redactDomSelector(selector: string): string {
  return selector.replace(SELECTOR_LABEL_ATTRIBUTES, "[$1]");
}

export function scrubUrl(url: string): string {
  return redactPathSecrets(redactCoordinates(stripUrlQuery(url)));
}

/**
 * For free text (exception messages): strip anything from a URL query (`?key=`) to the end
 * of that line, plus coordinates. To the end of the LINE, not the next space: Graph OData
 * filters contain spaces (`$filter=from/emailAddress/address eq 'a@b.c'`), and stopping at
 * the first space leaked the email in a test. A plain question mark in prose survives.
 */
export function scrubText(text: string): string {
  return redactPathSecrets(redactCoordinates(text.replace(/\?[^\s'"=]*=.*$/gm, "")));
}

function scrubUrlField(obj: Dict | undefined, key: string) {
  if (obj && typeof obj[key] === "string") obj[key] = scrubUrl(obj[key] as string);
}

/** beforeBreadcrumb. Console breadcrumbs are dropped outright; URLs lose query + coords. */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(breadcrumb: B): B | null {
  if (breadcrumb.category === "console") return null;
  scrubUrlField(breadcrumb.data, "url");
  scrubUrlField(breadcrumb.data, "from");
  scrubUrlField(breadcrumb.data, "to");
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = scrubText(breadcrumb.message);
    // ui.click / ui.input messages are element selectors (see the header comment).
    if (breadcrumb.category?.startsWith("ui.")) breadcrumb.message = redactDomSelector(breadcrumb.message);
  }
  return breadcrumb;
}

/**
 * beforeSend. `originalException` (from the SDK's hint) is only read for a Prisma error
 * code; nothing from it is copied onto the event.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E, originalException?: unknown): E {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    if (typeof request.url === "string") request.url = scrubUrl(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => ALLOWED_REQUEST_HEADERS.includes(name.toLowerCase())),
      );
    }
  }

  // Only the opaque Person id may identify a user — never name, email, IP, or username.
  if (event.user) {
    event.user = event.user.id != null ? { id: event.user.id } : {};
  }

  // The SDK's culture context carries the machine's timezone — a coarse location.
  if (event.contexts?.culture) delete event.contexts.culture.timezone;

  for (const context of Object.values(event.contexts ?? {})) {
    if (!context) continue;
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === "string" && (value.startsWith("/") || /^https?:\/\//.test(value))) {
        context[key] = scrubUrl(value);
      }
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is NonNullable<typeof b> => b != null);
  }

  for (const ex of event.exception?.values ?? []) {
    if (ex.type?.startsWith("PrismaClient")) {
      // Validation errors print the call's arguments — real field values. Keep the class and
      // the error code (e.g. P2002), which say what went wrong without saying about whom.
      const code = (originalException as { code?: unknown } | undefined)?.code;
      ex.value = typeof code === "string" ? `${ex.type} ${code}` : ex.type;
    } else if (typeof ex.value === "string") {
      ex.value = scrubText(ex.value);
    }
  }

  if (typeof event.message === "string") event.message = scrubText(event.message);
  if (typeof event.transaction === "string") event.transaction = scrubUrl(event.transaction);
  return event;
}

const URL_ATTRIBUTES = ["url.full", "url.path", "http.url", "http.target", "url.template", "sentry.segment.name"];

/** Attributes that would identify a device or place, never needed to debug the app. */
const DROPPED_ATTRIBUTES = ["url.query", "http.query", "culture.timezone", "server.address"];

// Web-vital span attributes that hold an element selector (see redactDomSelector).
const WEB_VITAL_SELECTOR = /^browser\.web_vital\.(inp\.target|lcp\.element|cls\.source\.\d+)$/;

/**
 * beforeSendSpan. In v11 this callback can edit a span but not drop it, so requests that
 * must never appear (the NWS forecast, whose path is the household's location) are also
 * excluded at the fetch integration in ./options.ts. This is the second layer.
 *
 * Fails CLOSED: if this callback throws, the SDK sends the span *unmodified* (unlike
 * beforeSend, which drops the event), so any error here returns a stripped span instead.
 */
export function scrubSpan<S extends ScrubbableSpan>(span: S): S {
  try {
    span.attributes ??= {};
    if (typeof span.name === "string") span.name = scrubUrl(span.name);
    const attributes = span.attributes;

    for (const key of URL_ATTRIBUTES) {
      if (typeof attributes[key] === "string") attributes[key] = scrubUrl(attributes[key] as string);
    }
    for (const key of DROPPED_ATTRIBUTES) delete attributes[key];

    const isWebVital = String(attributes["sentry.op"] ?? "").startsWith("ui.webvital");
    // The browser user agent is kept only where Sentry needs it to score web vitals; an
    // outgoing request's user agent can carry NWS_CONTACT_EMAIL (see lib/weather.ts).
    if (!isWebVital) delete attributes["user_agent.original"];

    for (const key of Object.keys(attributes)) {
      if (WEB_VITAL_SELECTOR.test(key) && typeof attributes[key] === "string") {
        attributes[key] = redactDomSelector(attributes[key] as string);
      }
      // The SDK copies the scope's user onto every span as user.* attributes even with
      // dataCollection.userInfo off (found by the composition test in ./sdk.test.ts).
      // Only the opaque id may stay.
      if (key.startsWith("user.") && key !== "user.id") delete attributes[key];
    }
    return span;
  } catch {
    span.name = "[scrub failed]";
    span.attributes = {};
    return span;
  }
}
