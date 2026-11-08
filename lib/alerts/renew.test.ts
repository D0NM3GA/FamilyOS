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
  it("tells two notes with the same link apart, and names the same one the same", () => {
    const ivy = pushTag("REMINDER_DOSE_DUE", "/meds", "Time for Ivy's 8:00 AM dose of Amoxicillin");
    const max = pushTag("REMINDER_DOSE_DUE", "/meds", "Time for Max's 8:00 AM dose of Vitamin D");
    expect(ivy).not.toBe(max);
    expect(ivy).toBe(pushTag("REMINDER_DOSE_DUE", "/meds", "Time for Ivy's 8:00 AM dose of Amoxicillin"));
    expect(ivy.startsWith("REMINDER_DOSE_DUE:")).toBe(true);
    expect(ivy.length).toBeLessThanOrEqual(64);
  });
});
