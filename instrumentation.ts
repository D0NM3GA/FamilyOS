import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Phase 40.1b: a half-set Microsoft sign-in stops the server here, at start, with the
    // missing settings named, rather than on the first signed-in request.
    const { microsoftConfigFrom } = await import("./lib/microsoft-config");
    microsoftConfigFrom(process.env);
    // Phase 40.3: the same for a half-set OIDC provider. A whole one is checked here too, with a
    // time limit; if it can't be reached the app starts without it (the owner's call), and says so.
    const { oidcConfigFrom } = await import("./lib/oidc-config");
    const oidc = oidcConfigFrom(process.env);
    if (oidc) {
      const { checkOidcDiscovery, recordOidcPreflight } = await import("./lib/oidc-preflight");
      const problem = await checkOidcDiscovery(oidc);
      recordOidcPreflight(problem === null);
      if (problem) console.warn(`[sign-in] ${oidc.name} sign-in is off until the next restart: ${problem}.`);
    }
    // Phase 42: a malformed Cloudflare Access setting is said once, plainly, at start (proxy.ts
    // then answers 503 rather than crashing every request).
    const { accessConfigFrom } = await import("./lib/security/cf-access");
    try {
      if (accessConfigFrom(process.env)) console.info("[access] Only requests through Cloudflare Access are let in.");
    } catch (err) {
      console.error(`[access] ${err instanceof Error ? err.message : err} Every request but the health check gets a 503 until it's fixed.`);
    }
    // Phase 49: the server keeps the household's time, from before the first request (a stored
    // day written in another zone is moved first). Not during `next build`, which has no database.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { syncServerZone } = await import("./lib/household-zone");
      try {
        await syncServerZone();
      } catch (err) {
        console.error(`[zone] Couldn't read the household's timezone at start (${err instanceof Error ? err.constructor.name : "unknown"}); the first page or background tick tries again.`);
      }
    }
    // Phase 27: after Sentry, so a job error is reported. Node only (lib/background.ts).
    const { startBackgroundJobs } = await import("./lib/background");
    startBackgroundJobs();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Server Components, Route Handlers, Server Actions and proxy errors
// (Next's onRequestError routeType: render | route | action | proxy).
export const onRequestError = Sentry.captureRequestError;
