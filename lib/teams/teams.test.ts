import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK, type FamilyLook } from "@/lib/family-look";
import { resetAppTokenCache } from "@/lib/graph/app-token";
import { renderOutlineIcon } from "@/lib/app-icon";
import { PRODUCT_NAME } from "@/lib/app-name";
import { buildManifest, nextVersion, packageHash, packageZip } from "./manifest";
import { ensureInChat, ensurePersonalChat, listGroupChats, publishPackage, sendToChat, TeamsError } from "./microsoft";
import { zipFiles } from "./zip";

/** Phase 50: the family's Teams app (docs/PLAN.md, Phase 50). No live Microsoft call here. */

const look: FamilyLook = { ...DEFAULT_LOOK, appName: "ParkerOS" };
const inputs = { look, appId: "11111111-2222-3333-4444-555555555555", baseUrl: "https://home.example.com", manifestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", version: "1.0.0" };

describe("the Teams app package", () => {
  it("is a notification-only bot named for the family, at this install's own address", () => {
    const m = buildManifest(inputs);
    expect(m.name.short).toBe("ParkerOS");
    expect(m.developer.name).toBe("ParkerOS");
    expect(JSON.stringify(m)).not.toContain(PRODUCT_NAME);
    expect(m.bots).toEqual([expect.objectContaining({ botId: inputs.appId, isNotificationOnly: true, scopes: ["personal", "groupChat"] })]);
    // Without it, Graph won't let the app install or list itself.
    expect(m.webApplicationInfo).toEqual({ id: inputs.appId, resource: `api://botid-${inputs.appId}` });
    expect(m.validDomains).toEqual(["home.example.com"]);
    expect(m.developer.websiteUrl).toBe("https://home.example.com");
    expect(m.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps to Teams' lengths", () => {
    const m = buildManifest({ ...inputs, look: { ...look, appName: "The Very Long Family Name Organizer OS" } });
    expect(m.name.short.length).toBeLessThanOrEqual(30);
    expect(m.developer.name.length).toBeLessThanOrEqual(32);
    expect(m.description.short.length).toBeLessThanOrEqual(80);
  });

  it("gets a new version only when what it's built from changes", () => {
    expect(nextVersion(null)).toBe("1.0.0");
    expect(nextVersion("1.0.4")).toBe("1.0.5");
    const icon = Buffer.from("png");
    const a = packageHash(buildManifest(inputs), icon, icon);
    expect(packageHash(buildManifest({ ...inputs, version: "1.0.7" }), icon, icon)).toBe(a);
    expect(packageHash(buildManifest({ ...inputs, look: { ...look, appName: "SmithOS" } }), icon, icon)).not.toBe(a);
    expect(packageHash(buildManifest(inputs), Buffer.from("other"), icon)).not.toBe(a);
  });

  it("zips the manifest and both icons, the same bytes for the same files", () => {
    const zip = packageZip(buildManifest(inputs), Buffer.from("c"), Buffer.from("o"));
    expect(zip.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
    for (const name of ["manifest.json", "color.png", "outline.png"]) expect(zip.includes(Buffer.from(name))).toBe(true);
    expect(zipFiles([{ name: "a", data: Buffer.from("x") }]).equals(zipFiles([{ name: "a", data: Buffer.from("x") }]))).toBe(true);
  });

  it("draws the outline icon in white on transparent only (Teams refuses anything else)", async () => {
    for (const l of [look, { ...look, appName: "★ Home" }]) {
      const png = Buffer.from(await (await renderOutlineIcon(l, 32)).arrayBuffer());
      const { width, height, rgba } = decodePng(png);
      expect([width, height]).toEqual([32, 32]);
      let drawn = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 0) continue;
        drawn++;
        expect([rgba[i], rgba[i + 1], rgba[i + 2]]).toEqual([255, 255, 255]);
      }
      expect(drawn).toBeGreaterThan(20);
    }
  });
});

// ---------- Microsoft calls, against a fake ----------

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function fake(routes: Route) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchFn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith("https://login.microsoftonline.com/")) {
      return Response.json({ access_token: `token-${calls.filter((c) => c.url === "token").length}`, expires_in: 3600 }, { status: 200 });
    }
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    return routes(url, init);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

describe("Microsoft calls", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.MICROSOFT_TENANT_ID = "tenant-1";
    process.env.MICROSOFT_CLIENT_ID = inputs.appId;
    process.env.MICROSOFT_CLIENT_SECRET = "secret";
    resetAppTokenCache();
  });
  afterEach(() => {
    process.env = { ...env };
    resetAppTokenCache();
  });

  it("sends to a chat through Bot Connector's global address", async () => {
    const f = fake(() => json({ id: "activity-1" }, 201));
    await sendToChat("19:abc@thread.v2", { type: "message" }, { fetchFn: f.fetchFn });
    expect(f.calls[0].url).toBe("https://smba.trafficmanager.net/teams/v3/conversations/19%3Aabc%40thread.v2/activities");
    expect(f.calls[0].method).toBe("POST");
  });

  it.each([
    [403, { error: { code: "BotDisabledByAdmin" } }, "notAllowed"],
    [403, { error: { code: "ConversationBlockedByUser" } }, "notAllowed"],
    [403, { error: { code: "BotNotInConversationRoster" } }, "gone"],
    [403, { error: { code: "ForbiddenOperationException" } }, "gone"],
    [403, { error: { code: "Unauthorized" } }, "failed"],
    [404, { error: { code: "ConversationNotFound" } }, "gone"],
    [500, {}, "failed"],
  ])("turns a %s %j into %s, in fixed words", async (status, body, kind) => {
    const f = fake(() => json({ ...body, error: { ...(body as { error?: object }).error, message: "Mom's chat 19:secret" } }, status));
    const err = await sendToChat("19:abc@thread.v2", {}, { fetchFn: f.fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamsError);
    expect((err as TeamsError).kind).toBe(kind);
    expect((err as Error).message).not.toMatch(/Mom|secret/);
  });

  it("gets a fresh token after a 401, and waits out one 429", async () => {
    let n = 0;
    const f = fake(() => (++n === 1 ? json({}, 401) : json({}, 201)));
    await sendToChat("19:abc@thread.v2", {}, { fetchFn: f.fetchFn });
    expect(f.calls).toHaveLength(2);

    let m = 0;
    const sleep = vi.fn(async () => {});
    const g = fake(() => (++m === 1 ? json({}, 429, { "Retry-After": "3" }) : json({}, 201)));
    await sendToChat("19:abc@thread.v2", {}, { fetchFn: g.fetchFn, sleep });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("installs the app for a person when it isn't, then reads their chat", async () => {
    let installed = false;
    const f = fake((url, init) => {
      if (url.endsWith("/chat")) return json({ id: "19:dm@unq.gbl.spaces" });
      if (init.method === "POST") {
        installed = true;
        return json({}, 201);
      }
      return json({ value: installed ? [{ id: "install-1" }] : [] });
    });
    const out = await ensurePersonalChat("aad-1", "catalog-1", { fetchFn: f.fetchFn });
    expect(out).toEqual({ installId: "install-1", chatId: "19:dm@unq.gbl.spaces" });
    expect(f.calls[0].url).toContain("/users/aad-1/teamwork/installedApps?$expand=teamsApp&$filter=");
    expect(JSON.parse(String(f.calls[1].body))).toEqual({ "teamsApp@odata.bind": "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/catalog-1" });
  });

  it("says plainly when Teams won't allow the app for someone", async () => {
    const f = fake(() => json({ error: { code: "Forbidden" } }, 403));
    const err = await ensurePersonalChat("aad-1", "catalog-1", { fetchFn: f.fetchFn }).catch((e: unknown) => e);
    expect((err as TeamsError).kind).toBe("notAllowed");
  });

  it("lists group chats with members, marks people from outside, and only follows Graph's own next link", async () => {
    const f = fake((url) =>
      url.includes("skiptoken")
        ? json({ value: [{ id: "19:b@thread.v2", topic: null, chatType: "group", members: [{ displayName: "Mom Parker", tenantId: "tenant-1" }] }] })
        : json({
            value: [
              { id: "19:a@thread.v2", topic: "Parkers", chatType: "group", members: [{ displayName: "Dad Parker", tenantId: "tenant-1" }, { displayName: "Pat Example", tenantId: "other" }] },
              { id: "19:m@thread.v2", topic: "Meeting", chatType: "meeting", members: [] },
            ],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=1",
          }),
    );
    const chats = await listGroupChats("delegated", "tenant-1", f.fetchFn);
    expect(chats.map((c) => c.id)).toEqual(["19:a@thread.v2", "19:b@thread.v2"]);
    expect(chats[0].members).toEqual([
      { name: "Dad Parker", outside: false },
      { name: "Pat Example", outside: true },
    ]);
    const h = fake(() => json({ value: [], "@odata.nextLink": "https://evil.example/steal" }));
    await listGroupChats("delegated", "tenant-1", h.fetchFn);
    expect(h.calls).toHaveLength(1);
  });

  it("publishes a new app, or a new version of one already there", async () => {
    const f = fake(() => json({ id: "catalog-9" }, 201));
    expect(await publishPackage("delegated", Buffer.from("zip"), { teamsAppId: null, manifestId: inputs.manifestId }, f.fetchFn)).toBe("catalog-9");
    expect(f.calls[0].url).toBe("https://graph.microsoft.com/v1.0/appCatalogs/teamsApps");

    const g = fake(() => json({}, 201));
    expect(await publishPackage("delegated", Buffer.from("zip"), { teamsAppId: "catalog-9", manifestId: inputs.manifestId }, g.fetchFn)).toBe("catalog-9");
    expect(g.calls[0].url).toBe("https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/catalog-9/appDefinitions");

    const h = fake(() => json({ error: { code: "Forbidden" } }, 403));
    const err = await publishPackage("delegated", Buffer.from("zip"), { teamsAppId: null, manifestId: inputs.manifestId }, h.fetchFn).catch((e: unknown) => e);
    expect((err as TeamsError).kind).toBe("needsAdmin");
  });

  it("finds an app already in the catalog by its fixed id, and publishes a new version of it", async () => {
    const f = fake((url, init) => {
      if (url.endsWith("/appCatalogs/teamsApps") && init.method === "POST") return json({ error: { code: "Conflict" } }, 409);
      if (url.includes("$filter=")) return json({ value: [{ id: "catalog-7" }] });
      return json({}, 201);
    });
    expect(await publishPackage("delegated", Buffer.from("zip"), { teamsAppId: null, manifestId: inputs.manifestId }, f.fetchFn)).toBe("catalog-7");
    expect(decodeURIComponent(f.calls[1].url)).toContain(`externalId eq '${inputs.manifestId}'`);
    expect(f.calls[2].url).toBe("https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/catalog-7/appDefinitions");
  });

  it("publishes as new once when the app was removed from the catalog, and never loops", async () => {
    const f = fake((url, init) => {
      if (url.endsWith("/appDefinitions")) return json({}, 404);
      if (url.endsWith("/appCatalogs/teamsApps") && init.method === "POST") return json({ error: {} }, 409);
      return json({ value: [{ id: "catalog-7" }] });
    });
    const err = await publishPackage("delegated", Buffer.from("zip"), { teamsAppId: "catalog-7", manifestId: inputs.manifestId }, f.fetchFn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamsError);
    expect(f.calls.filter((c) => c.url.endsWith("/appDefinitions"))).toHaveLength(2);
  });

  it("adds the app to a chat only when it isn't there", async () => {
    const there = fake(() => json({ value: [{ id: "x" }] }));
    await ensureInChat("19:a@thread.v2", "catalog-1", { fetchFn: there.fetchFn });
    expect(there.calls.map((c) => c.method)).toEqual(["GET"]);
    const missing = fake((_url, init) => (init.method === "POST" ? json({}, 201) : json({ value: [] })));
    await ensureInChat("19:a@thread.v2", "catalog-1", { fetchFn: missing.fetchFn });
    expect(missing.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(missing.calls[1].url).toBe("https://graph.microsoft.com/v1.0/chats/19%3Aa%40thread.v2/installedApps");
  });
});

/** Just enough PNG reading for the icon check: 8-bit RGBA, not interlaced. */
function decodePng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0]);
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (v + [0, a, b, Math.floor((a + b) / 2), paeth][filter]) & 0xff;
    }
  }
  return { width, height, rgba: out };
}
