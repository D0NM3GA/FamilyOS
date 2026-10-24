import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plainCardText, teamsActivity } from "./teams";
import { emailPayload, mailError, pickAlertMailbox, sendEmail, serverAlertMailbox, type MailError } from "./email";
import { getAppGraphToken, resetAppTokenCache } from "@/lib/graph/app-token";
import { isPrivateOutgoingRequest } from "@/lib/observability/options";

describe("teamsActivity (Phase 50)", () => {
  it("is one Adaptive Card message, its link as text", () => {
    const a = teamsActivity("Ivy bought DJ in the car", "https://x/points#orders");
    expect(a.type).toBe("message");
    expect(a.attachments).toHaveLength(1);
    expect(a.attachments[0]).toMatchObject({ contentType: "application/vnd.microsoft.card.adaptive" });
    expect(a.attachments[0].content.type).toBe("AdaptiveCard");
    expect(JSON.stringify(a)).toContain("[Open the store](https://x/points#orders)");
    // Nothing about who it's for: the chat decides that.
    expect(JSON.stringify(a)).not.toMatch(/recipient|@example/);
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
    const card = teamsActivity("[x](https://evil.example)", "https://x/");
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
    expect(pickAlertMailbox("alerts@example.com")).toBeNull();
    expect(serverAlertMailbox()).toBeNull();
  });

  it("only uses a well-formed mailbox", () => {
    process.env.ALERT_MAILBOX = "nope";
    expect(serverAlertMailbox()).toBeNull();
    process.env.ALERT_MAILBOX = " familyos@example.com ";
    expect(serverAlertMailbox()).toBe("familyos@example.com");
  });

  it("Phase 53: the family's mailbox wins; the server's is the fallback", () => {
    process.env.ALERT_MAILBOX = "familyos@example.com";
    expect(pickAlertMailbox("alerts@example.com")).toBe("alerts@example.com");
    expect(pickAlertMailbox(null)).toBe("familyos@example.com");
    expect(pickAlertMailbox("  ")).toBe("familyos@example.com");
    expect(pickAlertMailbox("not an address")).toBe("familyos@example.com");
    delete process.env.ALERT_MAILBOX;
    expect(pickAlertMailbox("alerts@example.com")).toBe("alerts@example.com");
    expect(pickAlertMailbox(null)).toBeNull();
  });

  it("sends from the mailbox with a plain-text message", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    await sendEmail("familyos@example.com", "mom@example.com", "Ivy bought DJ", "https://x/points", "SmithOS", {
      fetchFn: fetchFn as unknown as typeof fetch,
      token: async () => "TOKEN",
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/familyos%40example.com/sendMail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(init.body as string)).toEqual(emailPayload("mom@example.com", "Ivy bought DJ", "https://x/points", "SmithOS"));
  });

  it("Phase 53: tells Microsoft's failures apart by its error code, without leaking its message", async () => {
    const send = (status: number, body: unknown) =>
      sendEmail("familyos@example.com", "a@b.co", "t", "l", "FamilyOS", {
        fetchFn: (async () => Response.json(body, { status })) as unknown as typeof fetch,
        token: async () => "T",
      }).then(
        () => null,
        (e: MailError) => ({ problem: e.problem, message: e.message }),
      );
    const err = (code: string) => ({ error: { code, message: "secret details" } });
    expect(await send(404, err("ErrorInvalidUser"))).toMatchObject({ problem: "noMailbox" });
    expect(await send(400, err("MailboxNotEnabledForRESTAPI"))).toMatchObject({ problem: "notReady" });
    expect(await send(403, err("ErrorAccessDenied"))).toMatchObject({ problem: "access" });
    expect(await send(403, "not json")).toMatchObject({ problem: "access" });
    expect(await send(401, err("InvalidAuthenticationToken"))).toMatchObject({ problem: "signIn" });
    expect(await send(500, err("ErrorInternalServerError"))).toMatchObject({ problem: "failed", message: "Microsoft couldn't send the email (500)." });
    for (const [status, code] of [[404, "ErrorInvalidUser"], [403, "ErrorAccessDenied"], [500, "x"]] as const) {
      expect((await send(status, err(code)))?.message).not.toContain("secret");
    }
  });

  it("a code that isn't one of Microsoft's shapes is ignored", () => {
    expect(mailError(403, null, "familyos@example.com").problem).toBe("access");
    expect(mailError(404, null, "familyos@example.com").problem).toBe("noMailbox");
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

describe("Sentry never records a Teams chat or person", () => {
  it("treats Bot Connector and the Teams app's Graph calls as private outgoing requests", () => {
    expect(isPrivateOutgoingRequest("https://smba.trafficmanager.net/teams/v3/conversations/19%3Aabc%40thread.v2/activities")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/users/0000-1111/teamwork/installedApps")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/installedApps")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/me/chats?$top=50")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/appCatalogs/teamsApps")).toBe(true);
    expect(isPrivateOutgoingRequest("https://api.weather.gov/points/1,2")).toBe(true);
    expect(isPrivateOutgoingRequest("https://graph.microsoft.com/v1.0/me")).toBe(false);
  });
});
