import os from "node:os";
import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isPrivateOutgoingRequest, serverIntegrations, sharedSentryOptions } from "./options";

/**
 * Composition test (Fable's scope review): the real SDK, initialized with the same shared
 * options and integration filter as sentry.server.config.ts, sending to an in-memory
 * transport. Unit tests prove each scrubber alone; this proves the SDK's own default
 * integrations + dataCollection + scrubbers together still let no marker through.
 * Nothing leaves the machine: the fake transport replaces the network.
 */
const envelopes: unknown[] = [];
// The exact integration sentry.server.config.ts configures, so the test can check it
// actually replaced the SDK's default fetch integration rather than sitting beside it.
const fetchIntegration = Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: isPrivateOutgoingRequest });

// Built at runtime, never written out literally: Sentry attaches the source lines around
// each stack frame (code context, not data), so a literal marker in this file's source
// would show up in the payload and fail the test for the wrong reason.
const M = ["MAR", "KER"].join("");
const LAT = ["41", "8781"].join(".");
const COORDS = `${LAT},-87.6298`;

beforeAll(() => {
  Sentry.init({
    ...sharedSentryOptions(undefined),
    dsn: "https://public@example.invalid/1",
    enabled: true,
    tracesSampleRate: 1.0,
    includeLocalVariables: false,
    integrations: (defaults) => serverIntegrations(defaults, fetchIntegration),
    transport: () => ({
      send: async (envelope: unknown) => {
        envelopes.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});

afterAll(async () => {
  await Sentry.close();
});

function sentPayload(): string {
  return JSON.stringify(envelopes);
}

describe("Sentry SDK with the app's privacy options", () => {
  test("uses the configured fetch integration, no console integration, and streamed spans", () => {
    const client = Sentry.getClient();
    expect(client?.getIntegrationByName("NodeFetch")).toBe(fetchIntegration);
    expect(client?.getIntegrationByName("Console")).toBeUndefined();
    // beforeSendSpan only runs under the streaming lifecycle (see ./options.ts).
    expect(client?.getOptions().traceLifecycle).toBe("stream");
  });

  test("an error event carries none of the personal data put in front of it", async () => {
    Sentry.setUser({ id: "ckuser123", email: `${M}-EMAIL@example.com`, username: `${M}-NAME` });
    console.log(`${M}-CONSOLE`, { firstName: `${M}-CONSOLE-OBJ` });
    Sentry.addBreadcrumb({ category: "navigation", data: { from: `/people?x=${M}-REF`, to: `/search?q=${M}-QUERY` } });
    Sentry.addBreadcrumb({ category: "fetch", data: { url: `https://api.weather.gov/points/${COORDS}` } });

    Sentry.captureEvent({
      message: `render failed for /search?q=${M}-QUERY`,
      request: {
        url: `http://localhost:3000/search?q=${M}-QUERY`,
        query_string: `q=${M}-QUERY`,
        cookies: { active_profile: `${M}-COOKIE` },
        data: { note: `${M}-BODY` },
        headers: { cookie: `better-auth.session=${M}-COOKIE`, referer: `http://localhost:3000/people?x=${M}-REF` },
      },
      contexts: { nextjs: { request_path: `/search?q=${M}-QUERY` } },
    });

    const prismaError = new Error(`Invalid prisma.person.create(): { firstName: "${M}-PRISMA" }`);
    prismaError.name = "PrismaClientValidationError";
    Sentry.captureException(prismaError);

    await Sentry.flush(2000);
    const payload = sentPayload();
    expect(envelopes.length).toBeGreaterThan(0);
    expect(payload).not.toContain(M);
    expect(payload).not.toContain(LAT);
    expect(payload).toContain("ckuser123");
    // No machine hostname (serverName is fixed) and no timezone (a coarse location).
    expect(payload).not.toContain(os.hostname());
    expect(payload).not.toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  // Real-world shape: an outgoing request is a child span of a route-named request segment.
  // (A segment NAMED with personal data would also leak through the trace header's
  // "transaction" field, which beforeSendSpan can't reach. Next names server segments by
  // route pattern, e.g. "GET /vehicles/[id]", so that doesn't happen in this app; recorded
  // in docs/BUILD.md Phase 15.)
  test("a child span with a location path and a query-bearing URL is scrubbed", async () => {
    Sentry.startSpan({ name: "GET /vehicles/[id]" }, () => {
      Sentry.startSpan(
        {
          name: `GET /points/${COORDS}`,
          attributes: {
            "url.full": `https://graph.microsoft.com/v1.0/me/messages?$filter=${M}-SPAN`,
            "url.path": `/points/${COORDS}`,
            // Next puts the raw request target (query included) here; only scrubSpan covers it.
            "http.target": `/search?q=${M}-TARGET`,
            "user_agent.original": `FamilyCRM/0.1 (${M}-UA@example.com)`,
          },
        },
        () => undefined,
      );
    });
    await Sentry.flush(2000);
    const payload = sentPayload();
    expect(payload).toContain("points/[coords]");
    expect(payload).not.toContain(M);
    expect(payload).not.toContain(LAT);
  });
});
