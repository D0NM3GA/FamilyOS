import { beforeEach, describe, expect, test, vi } from "vitest";

type Profile = { id: string; role: "ADULT" | "KID" | "ADMIN"; householdId: string; authUserId: string | null };
const state = vi.hoisted(() => ({ profile: null as Profile | null, sessionOwner: true, fresh: true }));
vi.mock("@/lib/session", () => ({ signedInRecently: async () => state.fresh }));
vi.mock("@/lib/active-profile", () => ({
  getActiveProfile: async () => state.profile,
  isSessionOwner: async () => state.sessionOwner,
}));

import { authorizeRestore, MAX_RESTORE_BYTES } from "./restore-request";

const good = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
  host: "family.example",
  origin: "https://family.example",
};
const request = (headers: Record<string, string | undefined>) =>
  new Request("https://family.example/api/backup/restore?mode=preview", {
    method: "POST",
    headers: Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined)),
  });
const status = async (headers: Record<string, string | undefined>) => {
  const r = await authorizeRestore(request(headers));
  return "response" in r ? r.response.status : 200;
};

test("Phase 28: a restore needs a sign-in from the last 15 minutes", async () => {
  state.profile = { id: "a", role: "ADMIN", householdId: "h", authUserId: "u" };
  state.sessionOwner = true;
  state.fresh = false;
  expect(await status(good)).toBe(403);
  state.fresh = true;
  expect(await status(good)).toBe(200);
});

beforeEach(() => {
  state.profile = { id: "p1", role: "ADMIN", householdId: "h1", authUserId: "u1" };
  state.sessionOwner = true;
});

describe("authorizeRestore", () => {
  test("the app's own fetch from the signed-in admin passes", async () => {
    expect(await status(good)).toBe(200);
  });

  test.each([
    ["missing Sec-Fetch-Site", { "sec-fetch-site": undefined }, 403],
    ["cross-site", { "sec-fetch-site": "cross-site" }, 403],
    ["same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }, 403],
    ["a form post's content type", { "content-type": "application/x-www-form-urlencoded" }, 415],
    ["text/plain (no preflight)", { "content-type": "text/plain" }, 415],
    ["missing Origin", { origin: undefined }, 403],
    ["Origin for another host", { origin: "https://evil.example" }, 403],
    ["malformed Origin", { origin: "not a url" }, 403],
    ["declared too large", { "content-length": String(MAX_RESTORE_BYTES + 1) }, 413],
  ])("refuses %s", async (_label, override, expected) => {
    expect(await status({ ...good, ...override })).toBe(expected);
  });

  test("behind a proxy, Origin is compared with X-Forwarded-Host", async () => {
    expect(await status({ ...good, host: "localhost:3000", "x-forwarded-host": "family.example" })).toBe(200);
    expect(await status({ ...good, "x-forwarded-host": "other.example" })).toBe(403);
  });

  test("signed out is 401", async () => {
    state.profile = null;
    expect(await status(good)).toBe(401);
  });

  test.each([
    ["an adult", () => (state.profile = { ...state.profile!, role: "ADULT" })],
    ["an admin without a Microsoft sign-in", () => (state.profile = { ...state.profile!, authUserId: null })],
    ["an admin profile switched to with a PIN", () => (state.sessionOwner = false)],
  ])("refuses %s", async (_label, arrange) => {
    arrange();
    expect(await status(good)).toBe(403);
  });
});
