import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions, withoutConsoleIntegration } from "@/lib/observability/options";

// Edge runtime init, loaded from instrumentation.ts. Nothing in this app runs on the edge
// today (no proxy/middleware); this exists so a future edge route isn't silently unmonitored.
// The edge SDK's fetch integration has no NWS exclusion here — if a future edge route ever
// calls lib/weather.ts, add one (check @sentry/vercel-edge's option names first).
Sentry.init({
  ...sharedSentryOptions(),
  integrations: (defaults) => withoutConsoleIntegration(defaults),
});
