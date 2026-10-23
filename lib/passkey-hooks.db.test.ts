import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SoftAuthenticator } from "@/lib/test-support/soft-authenticator";
import { authCall, CookieJar, ORIGIN, RP_ID, scratchDatabase } from "@/lib/test-support/auth-harness";

/**
 * Phase 40.1c against a real, EMPTY database (`npm run test:db`): setting up a new install with
 * a passkey, end to end through Better Auth's own HTTP handler, with a software passkey
 * (lib/test-support/soft-authenticator.ts). Setup only happens while there's no household, so
 * this makes a scratch database, migrates it, points the app's modules at it, and drops it after.
 *
 * What it holds the code to: a setup token works once and only before setup; a passkey must be
 * made and used with the device's own lock (user verification); a signed-in browser can't add a
 * passkey; two finishes at once make one household; after setup, setup is closed.
 */
const RUN = import.meta.env.MODE === "db";

type Modules = {
  auth: typeof import("@/lib/auth").auth;
  setup: typeof import("@/lib/setup");
  prisma: typeof import("@/lib/prisma").prisma;
};

describe.skipIf(!RUN)("first-visitor setup with a passkey (scratch database)", { timeout: 180_000 }, () => {
  const db = scratchDatabase("fos_setup");
  let m: Modules;

  beforeAll(async () => {
    await db.create();
    m = {
      auth: (await import("@/lib/auth")).auth,
      setup: await import("@/lib/setup"),
      prisma: (await import("@/lib/prisma")).prisma,
    };
  }, 150_000);

  afterAll(() => db.drop(m?.prisma), 60_000);

  const call = (jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) => authCall(m.auth, jar, path, init);

  /** Runs a passkey registration with a setup token; returns the verify response. */
  async function register(jar: CookieJar, token: string, device: SoftAuthenticator, { userVerified = true } = {}) {
    const optionsRes = await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`);
    if (!optionsRes.ok) return optionsRes;
    const options = await optionsRes.json();
    return call(jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options, { userVerified }), createSession: true } });
  }

  const details = { householdName: "The Parkers", firstName: "Dad", email: "dad-setup@example.com" };

  test("refuses a made-up or missing setup token", async () => {
    const jar = new CookieJar();
    expect((await call(jar, "/passkey/generate-register-options?context=made-up")).status).toBe(403);
    expect((await call(jar, "/passkey/generate-register-options")).status).toBe(403);
  });

  test("refuses a passkey made without the device's own lock, and leaves the token usable", async () => {
    const token = await m.setup.createSetupToken(details);
    const res = await register(new CookieJar(), token, new SoftAuthenticator(RP_ID, ORIGIN), { userVerified: false });
    expect(res.status).toBe(400);
    expect(await m.prisma.user.count()).toBe(0);
    expect(await m.prisma.passkey.count()).toBe(0);
    expect(await m.setup.readSetupToken(token)).toEqual(details);
  });

  test("a setup token makes one new user with a passkey and a session, once", async () => {
    const token = await m.setup.createSetupToken(details);
    const jar = new CookieJar();
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    const res = await register(jar, token, device);
    expect(res.status).toBe(200);
    expect(jar.has("session_token")).toBe(true);

    const user = await m.prisma.user.findUnique({ where: { email: details.email }, include: { passkeys: true } });
    expect(user?.name).toBe("Dad");
    expect(user?.passkeys).toHaveLength(1);
    expect(await m.setup.readFinishDetails(user!.id)).toEqual({ householdName: "The Parkers", firstName: "Dad" });

    // Used up: the same token can't start another passkey.
    expect((await call(new CookieJar(), `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).status).toBe(403);
  });

  test("a signed-in browser can't add a passkey", async () => {
    const signedIn = new CookieJar();
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    const token = await m.setup.createSetupToken({ ...details, email: "mom-setup@example.com" });
    expect((await register(signedIn, token, device)).status).toBe(200);
    // Now signed in as that user: a setup token isn't a ticket to add a passkey (40.2a), so it's
    // refused, and the token is left as it was.
    const second = await m.setup.createSetupToken({ ...details, email: "max-setup@example.com" });
    expect((await call(signedIn, `/passkey/generate-register-options?context=${encodeURIComponent(second)}`)).status).toBe(403);
    expect(await m.prisma.passkey.count({ where: { user: { email: "mom-setup@example.com" } } })).toBe(1);
    expect(await m.setup.readSetupToken(second)).not.toBeNull();
  });

  test("signing in with the passkey needs the device's own lock", async () => {
    const token = await m.setup.createSetupToken({ ...details, email: "grandma-setup@example.com" });
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await register(new CookieJar(), token, device)).status).toBe(200);

    const signIn = async (userVerified: boolean) => {
      const jar = new CookieJar();
      const options = await (await call(jar, "/passkey/generate-authenticate-options")).json();
      const res = await call(jar, "/passkey/verify-authentication", { method: "POST", body: { response: device.signIn(options, { userVerified }) } });
      return { res, jar };
    };
    expect((await signIn(false)).res.status).toBe(401);
    const ok = await signIn(true);
    expect(ok.res.status).toBe(200);
    expect(ok.jar.has("session_token")).toBe(true);
  });

  test("a sign-in signed by another key, or replayed, is refused", async () => {
    const token = await m.setup.createSetupToken({ ...details, email: "ivy-setup@example.com" });
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await register(new CookieJar(), token, device)).status).toBe(200);

    // Same credential id, different private key: the signature can't check out.
    const impostor = Object.assign(new SoftAuthenticator(RP_ID, ORIGIN), { credentialId: device.credentialId });
    const jar = new CookieJar();
    let options = await (await call(jar, "/passkey/generate-authenticate-options")).json();
    expect((await call(jar, "/passkey/verify-authentication", { method: "POST", body: { response: impostor.signIn(options) } })).status).toBe(401);

    // A good response is good once: its challenge is used up.
    const replayJar = new CookieJar();
    options = await (await call(replayJar, "/passkey/generate-authenticate-options")).json();
    const response = device.signIn(options);
    const before = replayJar.header();
    expect((await call(replayJar, "/passkey/verify-authentication", { method: "POST", body: { response } })).status).toBe(200);
    const again = new CookieJar();
    for (const part of before.split("; ")) again.take(new Response(null, { headers: { "set-cookie": part } }));
    expect((await call(again, "/passkey/verify-authentication", { method: "POST", body: { response } })).status).toBe(400);
  });

  test("finishing a registration once signed in is refused, and so is a long label", async () => {
    const token = await m.setup.createSetupToken({ ...details, email: "longname-setup@example.com" });
    expect((await call(new CookieJar(), `/passkey/generate-register-options?context=${encodeURIComponent(token)}&name=${"x".repeat(41)}`)).status).toBe(400);

    // Start a registration signed out, then sign in elsewhere and try to finish it.
    const jar = new CookieJar();
    const options = await (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json();
    const other = await m.setup.createSetupToken({ ...details, email: "session-setup@example.com" });
    const signedIn = new CookieJar();
    expect((await register(signedIn, other, new SoftAuthenticator(RP_ID, ORIGIN))).status).toBe(200);
    // Only the session: this browser keeps its own registration challenge.
    for (const part of signedIn.header().split("; ")) {
      if (part.includes("session_token")) jar.take(new Response(null, { headers: { "set-cookie": part } }));
    }
    const response = new SoftAuthenticator(RP_ID, ORIGIN).register(options);
    // Signed in, a second session is refused outright (40.2a); without one, the plugin refuses
    // finishing a registration that was started for someone else.
    expect((await call(jar, "/passkey/verify-registration", { method: "POST", body: { response, createSession: true } })).status).toBe(400);
    expect((await call(jar, "/passkey/verify-registration", { method: "POST", body: { response } })).status).toBe(401);
    expect(await m.prisma.user.count({ where: { email: "longname-setup@example.com" } })).toBe(0);
  });

  test("a user left by an attempt that got no further is reused; one with a sign-in isn't", async () => {
    const orphan = await m.prisma.user.create({ data: { name: "Left over", email: "orphan-setup@example.com" } });
    const token = await m.setup.createSetupToken({ ...details, email: orphan.email! });
    expect((await register(new CookieJar(), token, new SoftAuthenticator(RP_ID, ORIGIN))).status).toBe(200);
    expect((await m.prisma.passkey.findMany({ where: { userId: orphan.id } })).length).toBe(1);

    const withMicrosoft = await m.prisma.user.create({ data: { name: "Has Microsoft", email: "ms-setup@example.com" } });
    await m.prisma.account.create({ data: { userId: withMicrosoft.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000aa" } });
    const second = await m.setup.createSetupToken({ ...details, email: withMicrosoft.email! });
    expect((await register(new CookieJar(), second, new SoftAuthenticator(RP_ID, ORIGIN))).status).toBe(409);
    expect(await m.prisma.passkey.count({ where: { userId: withMicrosoft.id } })).toBe(0);
  });

  let lateToken = "";
  test("a token made before setup finishes", async () => {
    lateToken = await m.setup.createSetupToken({ ...details, email: "late-token@example.com" });
    expect(await m.setup.readSetupToken(lateToken)).not.toBeNull();
  });

  test("two finishes at once make one household; then setup is closed", async () => {
    const users = await m.prisma.user.findMany({ where: { email: { in: [details.email, "mom-setup@example.com"] } } });
    expect(users).toHaveLength(2);
    const results = await Promise.allSettled(users.map((u) => m.setup.finishSetup({ id: u.id, email: u.email }, { householdName: "The Parkers", firstName: u.name })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(m.setup.SetupError);
    expect(await m.prisma.household.count()).toBe(1);
    expect(await m.prisma.person.count({ where: { role: "ADMIN", isHouseholdMember: true } })).toBe(1);

    expect(await m.setup.isSetUp()).toBe(true);
    await expect(m.setup.createSetupToken({ ...details, email: "late@example.com" })).rejects.toBeInstanceOf(m.setup.SetupError);
    // A token from before setup is no good after it.
    expect((await call(new CookieJar(), `/passkey/generate-register-options?context=${encodeURIComponent(lateToken)}`)).status).toBe(403);
  });

  test("expired sign-in leftovers are cleared", async () => {
    await m.prisma.verification.create({ data: { identifier: "stale-test", value: "{}", expiresAt: new Date(Date.now() - 60_000) } });
    expect(await m.setup.purgeExpiredVerifications()).toBeGreaterThanOrEqual(1);
    expect(await m.prisma.verification.count({ where: { identifier: "stale-test" } })).toBe(0);
  });
});
