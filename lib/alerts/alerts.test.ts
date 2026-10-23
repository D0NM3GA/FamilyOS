import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTeamsWebhookUrl, plainCardText, sendTeams, teamsPayload } from "./teams";
import { alertMailbox, emailPayload, sendEmail } from "./email";
import { getAppGraphToken, resetAppTokenCache } from "@/lib/graph/app-token";
import { isPrivateOutgoingRequest } from "@/lib/observability/options";

const LOGIC =
  "https://prod-00.example.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SECRET";
const PP =
  "https://default1234abcd.12.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sp=x&sv=1.0&sig=SECRET";

describe("checkTeamsWebhookUrl", () => {
  it("accepts both Workflows URL shapes and drops the explicit :443", () => {
    const a = checkTeamsWebhookUrl(LOGIC);
    expect(a).toMatchObject({ ok: true, host: "prod-00.example.logic.azure.com" });
    expect(a.ok && a.url.includes(":443")).toBe(false);
    expect(checkTeamsWebhookUrl(PP)).toMatchObject({ ok: true });
  });

  it.each([
    ["http (not https)", LOGIC.replace("https:", "http:")],
    ["another host", LOGIC.replace("logic.azure.com", "evil.com")],
    ["a lookalike host", LOGIC.replace("prod-00.example.logic.azure.com", "evillogic.azure.com.attacker.net")],
    ["the bare suffix", "https://logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=1"],
    ["userinfo", LOGIC.replace("https://", "https://me:pw@")],
    ["another port", LOGIC.replace(":443", ":8443")],
    ["no sig", LOGIC.replace("&sig=SECRET", "")],
    ["not a trigger path", LOGIC.replace("/triggers/manual/paths/invoke", "/runs")],
    ["garbage", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(checkTeamsWebhookUrl(url).ok).toBe(false);
  });
});

describe("sendTeams", () => {
  it("posts the recipient plus an Adaptive Card attachment, and never follows redirects", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    await sendTeams(LOGIC, "mom@example.com", "Ivy bought DJ in the car", "https://x/points#orders", fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("sig=SECRET");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual(teamsPayload("mom@example.com", "Ivy bought DJ in the car", "https://x/points#orders"));
    // What the family flow reads: triggerBody()?['recipient'] and attachments[0].content.
    expect(body.recipient).toBe("mom@example.com");
    expect(body.attachments[0]).toMatchObject({ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null });
    expect(body.attachments[0].content.type).toBe("AdaptiveCard");
  });

  it("throws fixed text that never contains the secret", async () => {
    const down = vi.fn(async () => {
      throw new TypeError(`fetch failed: ${LOGIC}`);
    });
    await expect(sendTeams(LOGIC, "a@b.co", "t", "l", down as unknown as typeof fetch)).rejects.toThrow("Couldn't reach Teams.");
    const gone = vi.fn(async () => new Response(null, { status: 404 }));
    const err = await sendTeams(LOGIC, "a@b.co", "t", "l", gone as unknown as typeof fetch).catch((e: Error) => e);
    expect(String(err)).not.toContain("SECRET");
  });
});

describe("plainCardText", () => {
  it("breaks Markdown links in names people typed, keeping the words", () => {
    const out = plainCardText("Over budget: [Open](https://evil.example) ] (x)");
    expect(out).not.toMatch(/\]\s*\(/);
    expect(out).toContain("[Open]");
    expect(out).toContain("https://evil.example");
  });

  it("leaves ordinary titles alone and is used for the card title", () => {
    expect(plainCardText("Dining went over budget (again)")).toBe("Dining went over budget (again)");
    const card = teamsPayload("a@b.c", "[x](https://evil.example)", "https://x/");
    expect(JSON.stringify(card.attachments[0].content.body[1])).not.toContain("](");
  });
});

describe("email", () => {
  // Alert email goes through the Microsoft app registration (Phase 40.1b), so these tests set
  // one up rather than depend on the developer's own .env.
  beforeEach(() => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret");
    vi.stubEnv("MICROSOFT_TENANT_ID", "00000000-0000-4000-8000-000000000000");
  });
  afterEach(() => {
    delete process.env.ALERT_MAILBOX;
    vi.unstubAllEnvs();
    resetAppTokenCache();
  });

  it("has no mailbox without Microsoft", () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    vi.stubEnv("MICROSOFT_TENANT_ID", "");
    process.env.ALERT_MAILBOX = "familyos@example.com";
    expect(alertMailbox()).toBeNull();
  });

  it("only uses a well-formed mailbox", () => {
    process.env.ALERT_MAILBOX = "nope";
    expect(alertMailbox()).toBeNull();
    process.env.ALERT_MAILBOX = " familyos@example.com ";
    expect(alertMailbox()).toBe("familyos@example.com");
  });

  it("sends from the mailbox with a plain-text message", async () => {
    process.env.ALERT_MAILBOX = "familyos@example.com";
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    await sendEmail("mom@example.com", "Ivy bought DJ", "https://x/points", "SmithOS", {
      fetchFn: fetchFn as unknown as typeof fetch,
      token: async () => "TOKEN",
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/familyos%40example.com/sendMail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(init.body as string)).toEqual(emailPayload("mom@example.com", "Ivy bought DJ", "https://x/points", "SmithOS"));
  });

  it("explains a permission problem without leaking anything", async () => {
    process.env.ALERT_MAILBOX = "familyos@example.com";
    const fetchFn = vi.fn(async () => new Response("{\"error\":\"secret details\"}", { status: 403 }));
    await expect(
      sendEmail("a@b.co", "t", "l", "FamilyOS", { fetchFn: fetchFn as unknown as typeof fetch, token: async () => "T" }),
    ).rejects.toThrow("mailbox permission");
  });

  it("refuses when the mailbox isn't configured", async () => {
    await expect(sendEmail("a@b.co", "t", "l", "FamilyOS", { token: async () => "T" })).rejects.toThrow("isn't set up");
  });
});

describe("getAppGraphToken", () => {
  // Stubbed, not `??=`: a .env with the Microsoft keys present but empty would leave them "".
  beforeEach(() => {
    vi.stubEnv("MICROSOFT_TENANT_ID", "tenant");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppTokenCache();
  });

  it("uses client credentials and caches until shortly before expiry", async () => {
    let now = 0;
    const fetchFn = vi.fn(async () => Response.json({ access_token: "A", expires_in: 3600 }));
    const opts = { fetchFn: fetchFn as unknown as typeof fetch, now: () => now };
    expect(await getAppGraphToken(opts)).toBe("A");
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
    now = 3000 * 1000;
    await getAppGraphToken(opts);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = 3400 * 1000; // past expiry minus 5 minutes
    await getAppGraphToken(opts);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("Sentry never records a Teams link", () => {
  it("treats Workflows hosts as private outgoing requests", () => {
    expect(isPrivateOutgoingRequest(LOGIC)).toBe(true);
    expect(isPrivateOutgoingRequest(PP)).toBe(true);
    expect(isPrivateOutgoingRequest("https://api.weather.gov/points/1,2")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/me")).toBe(false);
  });
});
