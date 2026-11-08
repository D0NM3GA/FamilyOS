import { describe, expect, it } from "vitest";
import { sameOriginJson } from "./renew-request";
import { pushTag } from "./dispatch";

/** Phase 68c: the renew route's own checks, and the push tag. */
const headers = (o: Record<string, string>) => new Headers({ "sec-fetch-site": "same-origin", "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com", ...o });

describe("POST /api/push/renew's checks", () => {
  it("takes only a same-origin JSON fetch from its own origin", () => {
    expect(sameOriginJson(headers({}))).toBe(true);
    expect(sameOriginJson(headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOriginJson(headers({ "content-type": "text/plain" }))).toBe(false);
    expect(sameOriginJson(headers({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOriginJson(headers({ origin: "not a url" }))).toBe(false);
  });
});

describe("pushTag", () => {
  it("is the kind and the link, at most 64 characters", () => {
    expect(pushTag("REMINDER_DOSE_DUE", "/meds")).toBe("REMINDER_DOSE_DUE:/meds");
    expect(pushTag("REMINDER_DATE", `/people/${"x".repeat(80)}`)).toHaveLength(64);
  });
});
