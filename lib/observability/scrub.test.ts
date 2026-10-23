import { describe, expect, test } from "vitest";
import { redactCoordinates, scrubBreadcrumb, scrubEvent, scrubSpan, scrubText, scrubUrl, stripUrlQuery } from "./scrub";

describe("URL helpers", () => {
  test("stripUrlQuery drops query and fragment", () => {
    expect(stripUrlQuery("/search?q=Ada#top")).toBe("/search");
    expect(stripUrlQuery("https://x.test/a/b")).toBe("https://x.test/a/b");
  });

  test("redactCoordinates hides a lat,lon pair wherever it appears (NWS puts it in the path)", () => {
    expect(redactCoordinates("https://api.weather.gov/points/41.8781,-87.6298")).toBe(
      "https://api.weather.gov/points/[coords]",
    );
  });

  test("an invite's token in a path is hidden, in URLs and in messages (Phase 40.2b)", () => {
    const token = "made-up-invite-token-0000000000000000000000";
    expect(scrubUrl(`https://app.example.com/invite/${token}?x=1`)).toBe("https://app.example.com/invite/[token]");
    expect(scrubText(`Failed rendering /invite/${token} for a guest`)).toBe("Failed rendering /invite/[token] for a guest");
    expect(scrubUrl("GET /invite/[token]")).toBe("GET /invite/[token]");
  });

  test("scrubText strips URL query strings from prose but keeps a normal question mark", () => {
    expect(scrubText("Graph request failed: 400 /me/messages?$filter=from/emailAddress/address eq 'a@b.c'")).not.toContain("a@b.c");
    expect(scrubText("Did it work?")).toBe("Did it work?");
  });
});

describe("scrubEvent", () => {
  test("removes cookies, bodies, query strings, and every header outside the allowlist", () => {
    const event = scrubEvent({
      request: {
        url: "http://localhost:3000/search?q=MARKER-QUERY",
        query_string: "q=MARKER-QUERY",
        cookies: { active_profile: "MARKER-COOKIE" },
        data: { note: "MARKER-BODY" },
        headers: { Cookie: "a=MARKER", Referer: "http://localhost:3000/people?x=MARKER-REF", "Content-Type": "text/html", "User-Agent": "Mozilla" },
      },
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain("MARKER");
    expect(event.request?.url).toBe("http://localhost:3000/search");
    expect(Object.keys(event.request?.headers ?? {})).toEqual(["Content-Type"]);
  });

  test("keeps only the opaque user id", () => {
    const event = scrubEvent({ user: { id: "ckabc123", email: "mom@example.com", ip_address: "10.0.0.5", username: "Mom" } });
    expect(event.user).toEqual({ id: "ckabc123" });
  });

  test("strips the query string from contexts.nextjs.request_path (not covered by urlQueryParams)", () => {
    const event = scrubEvent({ contexts: { nextjs: { request_path: "/search?q=MARKER-NAME", router_kind: "App Router" } } });
    expect(event.contexts?.nextjs?.request_path).toBe("/search");
    expect(event.contexts?.nextjs?.router_kind).toBe("App Router");
  });

  test("replaces a Prisma error's message (validation errors print real field values)", () => {
    const message = "Invalid `prisma.person.create()` invocation:\n{ data: { firstName: \"MARKER-PRISMA\" } }";
    const event = scrubEvent({ exception: { values: [{ type: "PrismaClientValidationError", value: message }] } });
    expect(event.exception?.values?.[0].value).toBe("PrismaClientValidationError");

    const known = scrubEvent(
      { exception: { values: [{ type: "PrismaClientKnownRequestError", value: "Unique constraint failed" }] } },
      { code: "P2002" },
    );
    expect(known.exception?.values?.[0].value).toBe("PrismaClientKnownRequestError P2002");
  });

  test("scrubs breadcrumbs inside the event and drops console ones", () => {
    const event = scrubEvent({
      breadcrumbs: [
        { category: "console", message: "MARKER-CONSOLE", data: { arguments: [{ firstName: "MARKER" }] } },
        { category: "navigation", data: { from: "/people?x=MARKER", to: "/search?q=MARKER" } },
        { category: "fetch", data: { url: "https://api.weather.gov/points/41.8781,-87.6298" } },
      ],
    });
    expect(JSON.stringify(event)).not.toContain("MARKER");
    expect(JSON.stringify(event)).not.toContain("41.8781");
    expect(event.breadcrumbs).toHaveLength(2);
  });
});

describe("scrubBreadcrumb", () => {
  test("drops console breadcrumbs entirely", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
  });
});

describe("scrubSpan", () => {
  test("cleans URL attributes, drops query attributes and the outgoing user agent", () => {
    const span = scrubSpan({
      name: "GET /points/41.8781,-87.6298",
      attributes: {
        "url.full": "https://graph.microsoft.com/v1.0/me/messages?$filter=MARKER",
        "url.path": "/points/41.8781,-87.6298",
        "url.query": "$filter=MARKER",
        "user_agent.original": "FamilyCRM/0.1 (mom@example.com)",
        "http.response.status_code": 200,
      },
    });
    const json = JSON.stringify(span);
    expect(json).not.toContain("MARKER");
    expect(json).not.toContain("41.8781");
    expect(json).not.toContain("mom@example.com");
    expect(span.attributes["http.response.status_code"]).toBe(200);
  });
});

describe("fix-pass cases (Fable's implementation review)", () => {
  test("ui.click breadcrumbs keep the element but lose its aria-label/title (avatars are named)", () => {
    const crumb = scrubBreadcrumb({ category: "ui.click", message: 'body > div.stack > div[aria-label="Ada Lovelace"][title="Ada Lovelace"]' });
    expect(crumb?.message).toBe("body > div.stack > div[aria-label][title]");
  });

  test("web-vital selector attributes are redacted, and the browser UA is kept only on web-vital spans", () => {
    const vital = scrubSpan({
      name: "INP",
      attributes: {
        "sentry.op": "ui.webvital.inp",
        "browser.web_vital.inp.target": 'div[aria-label="Ada Lovelace"]',
        "user_agent.original": "Mozilla/5.0",
      },
    });
    expect(vital.attributes["browser.web_vital.inp.target"]).toBe("div[aria-label]");
    expect(vital.attributes["user_agent.original"]).toBe("Mozilla/5.0");

    const outgoing = scrubSpan({ name: "GET x", attributes: { "sentry.op": "http.client", "user_agent.original": "FamilyCRM/0.1 (mom@example.com)" } });
    expect(outgoing.attributes["user_agent.original"]).toBeUndefined();
  });

  test("scrubSpan fails closed on malformed input instead of sending the span unscrubbed", () => {
    const broken = { name: 42, attributes: { get "url.full"(): string { throw new Error("boom"); } } } as never;
    const out = scrubSpan(broken) as unknown as { name: string; attributes: object };
    expect(out.name).toBe("[scrub failed]");
    expect(out.attributes).toEqual({});
  });

  test("NWS gridpoint cells are treated as location too", () => {
    expect(redactCoordinates("https://api.weather.gov/gridpoints/LOT/76,73/forecast")).toBe(
      "https://api.weather.gov/gridpoints/[coords]/forecast",
    );
  });

  test("http.target (Next's raw request target, with query) is scrubbed", () => {
    const span = scrubSpan({ name: "GET /search", attributes: { "http.target": "/search?q=Ada" } });
    expect(span.attributes["http.target"]).toBe("/search");
  });
});
