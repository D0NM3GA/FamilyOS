import { beforeEach, describe, expect, it, vi } from "vitest";

/** Phase 68c: POST /api/push/renew's answers, with the database and sign-in stood in. */
const state = { viewer: { householdId: "h1" } as null | { householdId: string }, renewed: [] as unknown[], result: true };
vi.mock("@/lib/active-profile", () => ({ getActiveProfile: async () => state.viewer }));
vi.mock("@/lib/alerts/devices", () => ({ renewDevice: async (...args: unknown[]) => (state.renewed.push(args), state.result) }));

const KEY = "B" + "A".repeat(86); // 65 bytes base64url, not a real point: the schema's point check is mocked below
vi.mock("@/lib/alerts/webpush", () => ({ isAllowedPushEndpoint: (u: string) => u.startsWith("https://push.example.com/"), isValidUaPublicKey: () => true }));

const request = (body: string, extra: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/push/renew", {
    method: "POST",
    body,
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com", ...extra },
  });
const good = JSON.stringify({ oldEndpoint: "https://push.example.com/old", subscription: { endpoint: "https://push.example.com/new", keys: { p256dh: KEY, auth: "A".repeat(22) } } });

beforeEach(() => {
  state.viewer = { householdId: "h1" };
  state.renewed = [];
  state.result = true;
});

describe("handleRenew", () => {
  it("moves the household's row for a good request", async () => {
    const { handleRenew } = await import("./renew-request");
    expect((await handleRenew(request(good))).status).toBe(200);
    expect(state.renewed[0]).toMatchObject(["h1", "https://push.example.com/old", { endpoint: "https://push.example.com/new" }]);
  });

  it("refuses a cross-site call, nobody signed in, a bad body, too much, and an unknown device", async () => {
    const { handleRenew } = await import("./renew-request");
    expect((await handleRenew(request(good, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await handleRenew(request("x".repeat(9000)))).status).toBe(413);
    expect((await handleRenew(request("{not json"))).status).toBe(400);
    expect((await handleRenew(request(JSON.stringify({ oldEndpoint: "x", subscription: { endpoint: "https://elsewhere.example/" } })))).status).toBe(400);
    state.result = false;
    expect((await handleRenew(request(good))).status).toBe(404);
    state.viewer = null;
    expect((await handleRenew(request(good))).status).toBe(401);
  });
});
