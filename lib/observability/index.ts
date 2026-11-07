import * as Sentry from "@sentry/nextjs";
import { describeError, log, type LogFields } from "./log";

export { describeError, log } from "./log";

/**
 * The app's only doorway to Sentry (Phase 15) — domain code imports these, never
 * `@sentry/nextjs` directly (enforced in eslint.config.mjs), so every call goes through
 * the same scrubbing config in ./options.ts.
 */

/** Tags this request's events with the active Person's opaque id — never name or email. */
export function setSentryUser(personId: string) {
  Sentry.setUser({ id: personId });
}

/**
 * Reports an error that was caught and handled, so it would otherwise go unseen. Phase 61: it's
 * also a log line (class and scrubbed message), so an error is seen without Sentry too: `event`
 * names it and `fields` add context (ids and fixed words only), one line per error.
 */
export function captureError(error: unknown, event = "error.caught", fields: LogFields = {}) {
  log.error(event, { ...fields, error: describeError(error) });
  Sentry.captureException(error);
}
