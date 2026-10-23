import * as Sentry from "@sentry/nextjs";
import { isPrivateOutgoingRequest, serverIntegrations, sharedSentryOptions } from "@/lib/observability/options";

// Node.js runtime init, loaded from instrumentation.ts. See lib/observability/ for what
// may and may not leave the house.
Sentry.init({
  ...sharedSentryOptions(),
  // The actual gate for stack-frame locals (dataCollection.stackFrameVariables only
  // filters them once collected). Locals routinely hold Person/Medication rows.
  includeLocalVariables: false,
  integrations: (defaults) =>
    serverIntegrations(defaults, Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: isPrivateOutgoingRequest })),
});
