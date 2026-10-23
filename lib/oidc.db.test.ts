import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authCall, CookieJar, ORIGIN, RP_ID, scratchDatabase } from "@/lib/test-support/auth-harness";
import { FakeIdp, type IdpPerson } from "@/lib/test-support/fake-idp";
import { SoftAuthenticator } from "@/lib/test-support/soft-authenticator";

/**
 * Phase 40.3 against a real database (`npm run test:db`), through Better Auth's own handler and a
 * fake OpenID Connect provider on 127.0.0.1 (lib/test-support/fake-idp.ts): who may sign up
 * through the provider (setup's first visitor, or a live invite), the ID token's checks (key,
 * audience, issuer, nonce), the invite's checks (a confirmed email, and the invite's), and the
 * 40.2c rules for people on it. Starts from an empty scratch database.
 */
const RUN = import.meta.env.MODE === "db";

type Modules = {
  auth: typeof import("@/lib/auth");
  setup: typeof import("@/lib/setup");
  invites: typeof import("@/lib/invites");
  signIns: typeof import("@/lib/sign-ins");
  signUp: typeof import("@/lib/oidc-sign-up");
  prisma: typeof import("@/lib/prisma").prisma;
};

const OIDC_KEYS = ["OIDC_DISCOVERY_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_NAME"] as const;

describe.skipIf(!RUN)("sign in with an OIDC provider (scratch database)", { timeout: 180_000 }, () => {
  const db = scratchDatabase("fos_oidc");
  const idp = new FakeIdp();
  let m: Modules;
  const call = (jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) => authCall(m.auth.auth, jar, path, init);
  let dad: { id: string; householdId: string; firstName: string };

  beforeAll(async () => {
    await idp.start();
    Object.assign(process.env, { OIDC_DISCOVERY_URL: idp.discoveryUrl, OIDC_CLIENT_ID: idp.clientId, OIDC_CLIENT_SECRET: idp.clientSecret, OIDC_NAME: "Example ID" });
    await db.create();
    m = {
      auth: await import("@/lib/auth"),
      setup: await import("@/lib/setup"),
      invites: await import("@/lib/invites"),
      signIns: await import("@/lib/sign-ins"),
      signUp: await import("@/lib/oidc-sign-up"),
      prisma: (await import("@/lib/prisma")).prisma,
    };
    // Discovery happened and the provider is loaded, or every test below would fail for that.
    expect(await m.auth.oidcSignIn()).toEqual({ name: "Example ID" });
  }, 150_000);

  afterAll(async () => {
    for (const k of OIDC_KEYS) delete process.env[k];
    await db.drop(m?.prisma);
    await idp.stop();
  }, 60_000);

  /** Starts a provider sign-in, signs in at the provider as `who`, and comes back. */
  async function providerSignIn(jar: CookieJar, who: IdpPerson, body: Record<string, unknown> = {}) {
    const start = await call(jar, "/sign-in/social", { method: "POST", body: { provider: "oidc", callbackURL: "/done", errorCallbackURL: "/failed", ...body } });
    if (!start.ok) return { status: start.status, location: null as string | null, start };
    const { url } = (await start.json()) as { url: string };
    const { code, state } = idp.authorize(url, who);
    const back = await call(jar, `/callback/oidc?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    return { status: back.status, location: back.headers.get("location"), start };
  }

  const userWithAccount = (sub: string) => m.prisma.user.findFirst({ where: { accounts: { some: { providerId: "oidc", accountId: sub } } } });
  const withInviteCookie = (token: string) => {
    const jar = new CookieJar();
    jar.take(new Response(null, { headers: { "set-cookie": `${m.signUp.INVITE_START_COOKIE}=${m.signUp.inviteStartValue(token)}` } }));
    return jar;
  };

  const dadAtIdp: IdpPerson = { sub: "dad-sub", email: "dad-oidc@example.com", email_verified: true, name: "Dad" };

  test("before setup, the first visitor can set the app up with the provider", async () => {
    const jar = new CookieJar();
    const back = await providerSignIn(jar, dadAtIdp, { requestSignUp: true, callbackURL: "/setup/finish" });
    expect(back.location).toContain("/setup/finish");
    expect(jar.has("session_token")).toBe(true);
    const user = await userWithAccount("dad-sub");
    expect(user?.email).toBe("dad-oidc@example.com");
    await m.setup.finishSetup({ id: user!.id, email: user!.email }, { householdName: "The Parkers", firstName: "Dad" });
    dad = await m.prisma.person.findUniqueOrThrow({ where: { authUserId: user!.id }, select: { id: true, householdId: true, firstName: true } });
    expect(await m.signIns.workingAdmins(m.prisma, dad.householdId)).toBe(1);
  });

  test("after setup: an unknown account is refused, and asking to sign up needs a live invite", async () => {
    const stranger: IdpPerson = { sub: "stranger", email: "stranger@example.com", email_verified: true };
    const refused = await providerSignIn(new CookieJar(), stranger);
    expect(refused.location).toMatch(/error=signup_disabled/);
    expect((await providerSignIn(new CookieJar(), stranger, { requestSignUp: true })).status).toBe(403);
    expect((await providerSignIn(withInviteCookie("made-up"), stranger, { requestSignUp: true })).status).toBe(403);
    // A real invite's token with a signature that isn't ours, or a cookie for an invite that's gone.
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Example", email: "forged-oidc@example.com", role: "ADULT" });
    const forged = new CookieJar();
    forged.take(new Response(null, { headers: { "set-cookie": `${m.signUp.INVITE_START_COOKIE}=${token}.${"A".repeat(43)}` } }));
    expect((await providerSignIn(forged, stranger, { requestSignUp: true })).status).toBe(403);
    const live = withInviteCookie(token);
    await m.prisma.invite.deleteMany({ where: { email: "forged-oidc@example.com" } });
    expect((await providerSignIn(live, stranger, { requestSignUp: true })).status).toBe(403);
    expect(await userWithAccount("stranger")).toBeNull();
  });

  test("never asked for: Microsoft signing up, an ID token from the browser, extra scopes", async () => {
    const jar = new CookieJar();
    expect((await call(jar, "/sign-in/social", { method: "POST", body: { provider: "microsoft", requestSignUp: true } })).status).toBe(403);
    expect((await call(jar, "/sign-in/social", { method: "POST", body: { provider: "oidc", idToken: { token: "x.y.z" } } })).status).toBe(403);
    expect((await call(jar, "/sign-in/social", { method: "POST", body: { provider: "oidc", scopes: ["admin"] } })).status).toBe(403);
  });

  test("a known account signs in; one whose ID token doesn't check out is refused", async () => {
    const ok = new CookieJar();
    expect((await providerSignIn(ok, dadAtIdp)).location).toContain("/done");
    expect(ok.has("session_token")).toBe(true);

    for (const tamper of [{ otherKey: true }, { aud: "someone-else" }, { iss: "https://evil.example.com" }, { nonce: "another-nonce" }, { nonce: null }]) {
      idp.tamper = tamper;
      const jar = new CookieJar();
      const back = await providerSignIn(jar, dadAtIdp);
      // Each is refused by the ID token's check, not by anything else.
      expect(back.location, JSON.stringify(tamper)).toMatch(/error=unable_to_get_user_info/);
      expect(jar.has("session_token"), JSON.stringify(tamper)).toBe(false);
    }
    idp.tamper = {};
  });

  test("an invite with the provider: a confirmed, matching email links them once; anything else is refused and cleared", async () => {
    const grandma = await m.prisma.person.create({ data: { householdId: dad.householdId, firstName: "Grandma", lastName: "Parker", role: "ADULT", isHouseholdMember: true } });
    const token = await m.invites.createInvite(dad, { who: "member", personId: grandma.id, email: "grandma-oidc@example.com", role: "ADULT" });

    const tryWith = async (who: IdpPerson) => {
      const back = await providerSignIn(withInviteCookie(token), who, { requestSignUp: true, callbackURL: `/invite/${token}/finish` });
      expect(back.location).toContain(`/invite/${token}/finish`);
      const user = await userWithAccount(who.sub);
      try {
        return await m.invites.acceptInviteForUser(token, user!.id);
      } catch (e) {
        await m.invites.discardOrphanSignIn(user!.id);
        throw e;
      }
    };

    await expect(tryWith({ sub: "g1", email: "grandma-oidc@example.com", email_verified: false })).rejects.toMatchObject({ code: "unverified" });
    await expect(tryWith({ sub: "g2", email: "grandma-oidc@example.com" })).rejects.toMatchObject({ code: "unverified" });
    await expect(tryWith({ sub: "g3", email: "someone-else@example.com", email_verified: true })).rejects.toMatchObject({ code: "mismatch" });
    // Each refused sign-in was cleared, and the invite is still there.
    expect(await m.prisma.account.count({ where: { providerId: "oidc", accountId: { in: ["g1", "g2", "g3"] } } })).toBe(0);
    expect(await m.invites.readInvite(token)).not.toBeNull();

    const { personId } = await tryWith({ sub: "g4", email: "grandma-oidc@example.com", email_verified: true });
    expect(personId).toBe(grandma.id);
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: grandma.id } })).authUserId).toBe((await userWithAccount("g4"))!.id);
    expect(await m.invites.readInvite(token)).toBeNull();
    // Afterwards she simply signs in.
    expect((await providerSignIn(new CookieJar(), { sub: "g4", email: "grandma-oidc@example.com", email_verified: true })).location).toContain("/done");
  });

  test("a sign-in left with the invite's email is cleared first, or the provider's account would be refused as not linked", async () => {
    await m.prisma.user.create({ data: { name: "Left over", email: "max-oidc@example.com" } });
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Max", lastName: "Parker", email: "max-oidc@example.com", role: "ADULT" });
    await m.invites.clearLeftoverSignIn("max-oidc@example.com");
    const back = await providerSignIn(withInviteCookie(token), { sub: "max-sub", email: "max-oidc@example.com", email_verified: true }, { requestSignUp: true });
    expect(back.location).not.toMatch(/error=/);
    await m.invites.acceptInviteForUser(token, (await userWithAccount("max-sub"))!.id);
  });

  test("a provider account whose email is a passkey person's is refused, never attached, and says no more than for a stranger", async () => {
    const user = await m.prisma.user.create({ data: { name: "Mom", email: "mom-oidc@example.com" } });
    await m.prisma.passkey.create({ data: { userId: user.id, credentialID: "mom-cred", publicKey: "x", counter: 0, deviceType: "singleDevice", backedUp: false } });
    const back = await providerSignIn(new CookieJar(), { sub: "mom-sub", email: "mom-oidc@example.com", email_verified: true });
    // Better Auth says "not linked" here; the address says what it says for an unknown account.
    expect(back.location).toMatch(/error=signup_disabled/);
    expect(back.location).not.toMatch(/account_not_linked/);
    expect(await m.prisma.account.count({ where: { userId: user.id } })).toBe(0);
  });

  test("signing out leaves the app only, and signing in again asks the provider to check again", async () => {
    const jar = new CookieJar();
    expect((await providerSignIn(jar, dadAtIdp)).location).toContain("/done");
    const out = await call(jar, "/sign-out", { method: "POST", body: {} });
    expect(out.headers.get("location")).toBeNull();
    expect(JSON.stringify(await out.json())).not.toContain(idp.url);

    const again = await call(new CookieJar(), "/sign-in/social", { method: "POST", body: { provider: "oidc", callbackURL: "/done", additionalParams: { prompt: "login" } } });
    const { url } = (await again.json()) as { url: string };
    expect(new URL(url).searchParams.get("prompt")).toBe("login");
  });

  test("a provider sign-in that never became anyone: cleared after an hour, never in an invite's way, and never the passkey's", async () => {
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Uncle", lastName: "Parker", email: "uncle-oidc@example.com", role: "ADULT" });
    // Signed up at the provider, then never finished.
    await providerSignIn(withInviteCookie(token), { sub: "uncle-sub", email: "uncle-oidc@example.com", email_verified: true }, { requestSignUp: true });
    const orphan = (await userWithAccount("uncle-sub"))!;
    // A Microsoft sign-in with nobody behind it isn't the orphan rule's to remove.
    const ms = await m.prisma.user.create({ data: { name: "Not provisioned", email: "ms-oidc@example.com" } });
    await m.prisma.account.create({ data: { userId: ms.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000ff" } });
    await m.invites.discardOrphanSignIn(ms.id);
    expect(await m.prisma.user.count({ where: { id: ms.id } })).toBe(1);

    // The same invite, used with a passkey instead: the orphan goes, the passkey gets a fresh sign-in.
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    const jar = new CookieJar();
    const options = await (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json();
    expect((await call(jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options), createSession: true } })).status).toBe(200);
    expect(await m.prisma.user.count({ where: { id: orphan.id } })).toBe(0);
    const uncle = await m.prisma.user.findUniqueOrThrow({ where: { email: "uncle-oidc@example.com" }, include: { accounts: true, passkeys: true } });
    expect(uncle.accounts).toHaveLength(0);
    expect(uncle.passkeys).toHaveLength(1);

    // Another, left an hour: the background tick clears it, and only it.
    const token2 = await m.invites.createInvite(dad, { who: "new", firstName: "Auntie", lastName: "Example", email: "auntie-oidc@example.com", role: "ADULT" });
    await providerSignIn(withInviteCookie(token2), { sub: "auntie-sub", email: "auntie-oidc@example.com", email_verified: true }, { requestSignUp: true });
    const left = (await userWithAccount("auntie-sub"))!;
    expect(await m.invites.purgeOrphanProviderSignIns()).toBe(0);
    await m.prisma.user.update({ where: { id: left.id }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await m.invites.purgeOrphanProviderSignIns()).toBe(1);
    expect(await m.prisma.user.count({ where: { id: ms.id } })).toBe(1);
  });

  test("a reset's link can't be used with the provider", async () => {
    const ivyUser = await m.prisma.user.create({ data: { name: "Aunt", email: "aunt-oidc@example.com" } });
    const aunt = await m.prisma.person.create({
      data: { householdId: dad.householdId, firstName: "Auntie", lastName: "Parker", role: "ADULT", isHouseholdMember: true, authUserId: ivyUser.id },
    });
    const token = await m.prisma.$transaction((tx) =>
      m.invites.createInviteIn(tx, dad, { who: "member", personId: aunt.id, email: "aunt-oidc@example.com", role: "ADULT" }, { hours: 1, recovery: true }),
    );
    const back = await providerSignIn(withInviteCookie(token), { sub: "aunt-sub", email: "aunt-oidc@example.com", email_verified: true }, { requestSignUp: true });
    expect(back.status).toBe(403);
  });

  test("an admin looks after people on the provider: no reset, but a role and taking the sign-in away", async () => {
    const grandma = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Grandma" } });
    expect((await m.signIns.managedPeople(dad.householdId, dad.id)).find((p) => p.id === grandma.id)).toMatchObject({ provider: true });
    await expect(m.signIns.resetPasskeys(dad, grandma.id)).rejects.toMatchObject({ code: "provider" });
    await m.signIns.changeRole(dad, grandma.id, "ADMIN");
    // Two admins on the provider: both count.
    expect(await m.signIns.workingAdmins(m.prisma, dad.householdId)).toBe(2);
    await m.signIns.removeSignIn(dad, grandma.id);
    expect(await userWithAccount("g4")).toBeNull();
    expect((await providerSignIn(new CookieJar(), { sub: "g4", email: "grandma-oidc@example.com", email_verified: true })).location).toMatch(/error=signup_disabled/);
  });
});
