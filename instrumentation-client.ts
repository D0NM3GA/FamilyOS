import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions, withoutConsoleIntegration } from "@/lib/observability/options";

// Browser init. Must live here, not in sentry.client.config.ts: Turbopack ignores that
// file entirely, with no error, leaving the browser unmonitored. No Session Replay and no
// User Feedback widget (owner's decision, Phase 15).
// Phase 46: the DSN comes from the page the server rendered (app/layout.tsx), not the build.
Sentry.init({
  ...sharedSentryOptions(document.documentElement.dataset.sentryDsn || undefined),
  integrations: (defaults) => withoutConsoleIntegration(defaults),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
