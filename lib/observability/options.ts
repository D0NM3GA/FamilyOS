import type { Breadcrumb, ErrorEvent, EventHint, init } from "@sentry/nextjs";
import { PRODUCT_NAME } from "@/lib/app-name";
import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";

// Derived from init()'s own option types: @sentry/nextjs doesn't re-export these two, and
// importing them from the transitive @sentry/core would pin an undeclared dependency.
type InitOptions = NonNullable<Parameters<typeof init>[0]>;
type DataCollection = NonNullable<InitOptions["dataCollection"]>;
type StreamedSpanJSON = Parameters<NonNullable<InitOptions["beforeSendSpan"]>>[0];

/**
 * The server's Sentry DSN, read at run time from the settings file. Phase 46: never built in
 * (a `NEXT_PUBLIC_` value would be inlined into the published image, server code included);
 * the browser gets it from the page (`data-sentry-dsn` on `<html>`, app/layout.tsx). Unset
 * (tests, CI, a fresh clone) means Sentry is fully off: the SDK is initialized with
 * `enabled: false` and sends nothing.
 */
export function serverSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || undefined;
}

/**
 * Every data category spelled out. @sentry/nextjs 11 flipped the defaults: an unset
 * `dataCollection` collects cookies, all request/response bodies, user info + IP, database
 * query parameters, and stack-frame local variables. Nothing here relies on a default.
 * Headers: an allowlist of three that carry no personal data (not user-agent — a family
 * device's UA is fingerprint-ish — and not Referer, which holds full URLs).
 */
export const DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["content-type", "accept", "accept-language"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  // Source lines around each frame — code, not data. Keeps dev stack traces readable.
  frameContextLines: 5,
};

/**
 * Options shared by the server, edge and browser SDKs (each runtime's init file adds its
 * own integrations). No Session Replay and no User Feedback, by the owner's decision.
 */
export function sharedSentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    // Otherwise every event's server_name carries the machine's hostname. (Applied to
    // browser and edge events too, where it's harmless.)
    serverName: PRODUCT_NAME.toLowerCase(),
    // Pinned, not left to the default: with SENTRY_TRACE_LIFECYCLE=static in some hosting
    // dashboard, a plain beforeSendSpan is silently skipped and spans would leave with only
    // dataCollection protecting them, which doesn't cover OTel attributes like http.target.
    traceLifecycle: "stream" as const,
    // All traces in dev (it's one family's traffic); a tenth once hosted.
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    dataCollection: DATA_COLLECTION,
    // Don't rewrite real Error messages our own catch blocks might read.
    enhanceFetchErrorMessages: "report-only" as const,
    beforeSend: (event: ErrorEvent, hint: EventHint) => scrubEvent(event, hint.originalException),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSendSpan: (span: StreamedSpanJSON) => scrubSpan(span),
  };
}

/** Console breadcrumbs store the raw logged objects (see ./scrub.ts); drop the integration. */
export function withoutConsoleIntegration<I extends { name: string }>(defaults: I[]): I[] {
  return defaults.filter((integration) => integration.name !== "Console");
}

/**
 * Requests whose URL itself is private get no span and no breadcrumb at all (the fetch
 * integration's own filter covers both):
 * - the NWS forecast URL's path IS the household's latitude/longitude;
 * - a Teams Workflows trigger URL's `sig` query parameter IS a bearer secret (Phase 21);
 * - a Web Push endpoint IS a device's capability (Phase 21.6).
 */
export function isPrivateOutgoingRequest(url: string): boolean {
  if (url.startsWith("https://api.weather.gov/")) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.endsWith(".logic.azure.com") || host.endsWith(".environment.api.powerplatform.com")) return true;
  // Phase 24: Document Intelligence requests carry receipt photos and results.
  if (host.endsWith(".cognitiveservices.azure.com")) return true;
  // Phase 25: bank feeds and card data.
  if (host === "api.privacy.com" || host === "sandbox.privacy.com" || host === "simplefin.org" || host.endsWith(".simplefin.org")) return true;
  // Phase 21.6: a Web Push endpoint's path (or WNS query) IS one device's capability.
  // Duplicated from lib/alerts/webpush.ts on purpose — this kernel imports no domain code.
  return (
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com")
  );
}

type ServerIntegration = { name: string };

/**
 * The Node server's integration list, shared by sentry.server.config.ts and the
 * composition test so the test exercises exactly what runs in production. The configured
 * fetch integration replaces the SDK's default instance of the same name (later,
 * non-default instances win in @sentry/core's integration setup).
 */
export function serverIntegrations<I extends ServerIntegration>(defaults: I[], nativeNodeFetch: I): I[] {
  return [...withoutConsoleIntegration(defaults), nativeNodeFetch];
}
