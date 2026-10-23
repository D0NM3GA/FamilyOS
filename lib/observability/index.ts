import * as Sentry from "@sentry/nextjs";

/**
 * The app's only doorway to Sentry (Phase 15) — domain code imports these, never
 * `@sentry/nextjs` directly (enforced in eslint.config.mjs), so every call goes through
 * the same scrubbing config in ./options.ts.
 */

/** Tags this request's events with the active Person's opaque id — never name or email. */
export function setSentryUser(personId: string) {
  Sentry.setUser({ id: personId });
}

/** Reports an error that was caught and handled, so it would otherwise go unseen. */
export function captureError(error: unknown) {
  Sentry.captureException(error);
}
