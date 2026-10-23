import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SoftAuthenticator } from "@/lib/test-support/soft-authenticator";
import { authCall, CookieJar, ORIGIN, RP_ID, scratchDatabase } from "@/lib/test-support/auth-harness";

/**
 * Phase 40.2a against a real database (`npm run test:db`), through Better Auth's own handler with
 * software passkeys: adding a passkey while signed in takes a fresh sign-in and a ticket bound to
 * that session, once; removing one is never the last and signs out your other devices; nobody
 * touches anyone else's. Starts from an empty scratch database so it can set up its own family.
 */
const RUN = import.meta.env.MODE === "db";

type Modules = {
  auth: typeof import("@/lib/auth").auth;
  setup: typeof import("@/lib/setup");
  my: typeof import("@/lib/my-passkeys");
  prisma: typeof import("@/lib/prisma").prisma;
};

describe.skipIf(!RUN)("my passkeys (scratch database)", { timeout: 180_000 }, () => {
  const db = scratchDatabase("fos_passkeys");
  let m: Modules;
  const call = (jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) => authCall(m.auth, jar, path, init);

  const dad = { jar: new CookieJar(), device: new SoftAuthenticator(RP_ID, ORIGIN), userId: "", personId: "" };
  const mom = { jar: new CookieJar(), device: new SoftAuthenticator(RP_ID, ORIGIN), userId: "", personId: "" };

  async function registerWithSetupToken(jar: CookieJar, device: SoftAuthenticator, email: string, firstName: string) {
    const token = await m.setup.createSetupToken({ householdName: "The Parkers", firstName, email });
    const options = await (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json();
    const res = await call(jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options), createSession: true } });
    expect(res.status).toBe(200);
    return (await m.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  beforeAll(async () => {
    await db.create();
    m = {
      auth: (await import("@/lib/auth")).auth,
      setup: await import("@/lib/setup"),
      my: await import("@/lib/my-passkeys"),
      prisma: (await import("@/lib/prisma")).prisma,
    };
    // Dad sets the app up; Mom's sign-in is made before setup closes, then joins as an adult.
    dad.userId = await registerWithSetupToken(dad.jar, dad.device, "dad-keys@example.com", "Dad");
    mom.userId = await registerWithSetupToken(mom.jar, mom.device, "mom-keys@example.com", "Mom");
    await m.setup.finishSetup({ id: dad.userId, email: "dad-keys@example.com" }, { householdName: "The Parkers", firstName: "Dad" });
    const household = await m.prisma.household.findFirstOrThrow();
    dad.personId = (await m.prisma.person.findUniqueOrThrow({ where: { authUserId: dad.userId } })).id;
    mom.personId = (
      await m.prisma.person.create({
        data: { householdId: household.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true, authUserId: mom.userId },
      })
    ).id;
  }, 150_000);

  afterAll(() => db.drop(m?.prisma), 60_000);

  async function sessionOf(jar: CookieJar) {
    const body = await (await call(jar, "/get-session")).json();
    return { id: body.session.id as string, userId: body.user.id as string, createdAt: body.session.createdAt as string };
  }

  async function addPasskey(jar: CookieJar, ticket: string, device: SoftAuthenticator, body: Record<string, unknown> = {}, { userVerified = true } = {}) {
    const optionsRes = await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`);
    if (!optionsRes.ok) return optionsRes;
    const options = await optionsRes.json();
    return call(jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options, { userVerified }), ...body } });
  }

  async function signInWith(device: SoftAuthenticator) {
    const jar = new CookieJar();
    const options = await (await call(jar, "/passkey/generate-authenticate-options")).json();
    const res = await call(jar, "/passkey/verify-authentication", { method: "POST", body: { response: device.signIn(options) } });
    return { res, jar };
  }

  const dadLaptop = new SoftAuthenticator(RP_ID, ORIGIN);

  test("a fresh sign-in adds another passkey with a ticket, once; it signs in and is in the audit log", async () => {
    const ticket = await m.my.createAddPasskeyTicket(await sessionOf(dad.jar), "Laptop");
    const res = await addPasskey(dad.jar, ticket, dadLaptop);
    expect(res.status).toBe(200);
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId } })).toBe(2);
    // Named from the ticket: the device's own prompt showed Dad's email, not the label.
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId, name: "Laptop" } })).toBe(1);
    // No second session: still the one browser session.
    expect(await m.prisma.session.count({ where: { userId: dad.userId } })).toBe(1);

    // Used up.
    expect((await call(dad.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).status).toBe(403);

    expect((await signInWith(dadLaptop)).res.status).toBe(200);
    const events = await m.prisma.signInEvent.findMany({ where: { subjectId: dad.personId } });
    expect(events).toMatchObject([{ kind: "PASSKEY_ADDED", actorId: dad.personId, actorName: "Dad", detail: "Laptop" }]);
  });

  test("signed in, no ticket, a made-up one, a setup token or someone else's ticket is refused", async () => {
    expect((await call(dad.jar, "/passkey/generate-register-options")).status).toBe(403);
    expect((await call(dad.jar, "/passkey/generate-register-options?context=made-up")).status).toBe(403);
    const momsTicket = await m.my.createAddPasskeyTicket(await sessionOf(mom.jar));
    expect((await call(dad.jar, `/passkey/generate-register-options?context=${encodeURIComponent(momsTicket)}`)).status).toBe(403);
    // Refusing it didn't use it up.
    expect(await m.my.addPasskeyTicketIsLive(momsTicket, await sessionOf(mom.jar))).toBe(true);
  });

  test("a ticket is this session's only: not Dad's other sign-in's, and a new one replaces it", async () => {
    const facts = await sessionOf(dad.jar);
    const first = await m.my.createAddPasskeyTicket(facts);
    const laptop = (await signInWith(dadLaptop)).jar;
    expect((await call(laptop, `/passkey/generate-register-options?context=${encodeURIComponent(first)}`)).status).toBe(403);
    expect(await m.my.addPasskeyTicketIsLive(first, facts)).toBe(true);
    const second = await m.my.createAddPasskeyTicket(facts);
    expect(await m.my.addPasskeyTicketIsLive(first, facts)).toBe(false);
    expect(await m.my.addPasskeyTicketIsLive(second, facts)).toBe(true);
  });

  test("an expired ticket is refused", async () => {
    const ticket = await m.my.createAddPasskeyTicket(await sessionOf(mom.jar));
    await m.prisma.verification.updateMany({ where: { identifier: { startsWith: "add-passkey:" } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(mom.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).status).toBe(403);
  });

  test("a registration started as Dad can't be finished as Mom", async () => {
    const facts = await sessionOf(dad.jar);
    const ticket = await m.my.createAddPasskeyTicket(facts);
    const options = await (await call(dad.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).json();
    // Dad's challenge, Mom's session.
    const swapped = dad.jar.without("session_token");
    for (const part of mom.jar.header().split("; ")) {
      if (part.includes("session_token")) swapped.take(new Response(null, { headers: { "set-cookie": part } }));
    }
    const res = await call(swapped, "/passkey/verify-registration", { method: "POST", body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options) } });
    expect(res.status).toBe(401);
    expect(await m.prisma.passkey.count({ where: { userId: { in: [dad.userId, mom.userId] } } })).toBe(3);
    expect(await m.my.addPasskeyTicketIsLive(ticket, facts)).toBe(true);
  });

  test("adding wants a sign-in from the last 5 minutes, removing from the last 15", async () => {
    const facts = await sessionOf(mom.jar);
    const ticket = await m.my.createAddPasskeyTicket(facts);
    const signedInAt = new Date(facts.createdAt);
    await m.prisma.session.update({ where: { id: facts.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    try {
      expect((await call(mom.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).status).toBe(403);
      await expect(m.my.createAddPasskeyTicket(await sessionOf(mom.jar))).rejects.toThrow("Sign in again first.");
      // Ten minutes in, removing still goes ahead as far as freshness goes (it's her only one).
      const only = await m.prisma.passkey.findFirstOrThrow({ where: { userId: mom.userId } });
      await expect(m.my.removePasskey(await sessionOf(mom.jar), only.id)).rejects.toThrow("only passkey");
      await m.prisma.session.update({ where: { id: facts.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
      expect((await call(mom.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).status).toBe(403);
      await expect(m.my.createAddPasskeyTicket(await sessionOf(mom.jar))).rejects.toThrow("Sign in again first.");
      await expect(m.my.removePasskey(await sessionOf(mom.jar), "anything")).rejects.toThrow("Sign in again first.");
    } finally {
      await m.prisma.session.update({ where: { id: facts.id }, data: { createdAt: signedInAt } });
    }
  });

  test("signed in, a registration can't make a second session or skip the device's lock", async () => {
    const facts = await sessionOf(dad.jar);
    const sessions = await m.prisma.session.count({ where: { userId: dad.userId } });
    const ticket = await m.my.createAddPasskeyTicket(facts);
    const options = await (await call(dad.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).json();
    const device = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await call(dad.jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options), createSession: true } })).status).toBe(400);
    expect((await call(dad.jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options, { userVerified: false }) } })).status).toBe(400);
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId } })).toBe(2);
    expect(await m.prisma.session.count({ where: { userId: dad.userId } })).toBe(sessions);
    expect(await m.my.addPasskeyTicketIsLive(ticket, facts)).toBe(true);
  });

  test("a registration started signed in can't be finished signed out", async () => {
    const ticket = await m.my.createAddPasskeyTicket(await sessionOf(dad.jar));
    const options = await (await call(dad.jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).json();
    const signedOut = dad.jar.without("session_token");
    const res = await call(signedOut, "/passkey/verify-registration", { method: "POST", body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options), createSession: true } });
    // Signed out after setup it's the invite path (40.2b), where a ticket is no invite.
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/invite has expired/);
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId } })).toBe(2);
  });

  test("someone on Microsoft doesn't add passkeys here", async () => {
    const household = await m.prisma.household.findFirstOrThrow();
    const user = await m.prisma.user.create({ data: { name: "Grandma", email: "grandma-keys@example.com" } });
    await m.prisma.account.create({ data: { userId: user.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000bb" } });
    await m.prisma.person.create({ data: { householdId: household.id, firstName: "Grandma", role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    expect(await m.my.passkeyPerson(user.id)).toBeNull();
    await expect(m.my.createAddPasskeyTicket({ id: "s", userId: user.id, createdAt: new Date() })).rejects.toBeInstanceOf(m.my.PasskeyError);
  });

  test("removing a passkey: not the last, never someone else's, and it signs out your other devices", async () => {
    const facts = await sessionOf(dad.jar);
    const laptopKey = await m.prisma.passkey.findFirstOrThrow({ where: { userId: dad.userId, name: "Laptop" } });

    // Mom can't remove Dad's.
    await expect(m.my.removePasskey(await sessionOf(mom.jar), laptopKey.id)).rejects.toThrow("isn't here anymore");
    await expect(m.my.renamePasskey(mom.userId, laptopKey.id, "Mine now")).rejects.toBeInstanceOf(m.my.PasskeyError);

    await m.my.renamePasskey(dad.userId, laptopKey.id, "Old laptop");
    await m.my.removePasskey(facts, laptopKey.id);
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId } })).toBe(1);
    expect(await m.prisma.session.findMany({ where: { userId: dad.userId }, select: { id: true } })).toEqual([{ id: facts.id }]);
    expect(await m.prisma.signInEvent.findFirst({ where: { subjectId: dad.personId, kind: "PASSKEY_REMOVED" } })).toMatchObject({ detail: "Old laptop" });

    const last = await m.prisma.passkey.findFirstOrThrow({ where: { userId: dad.userId } });
    await expect(m.my.removePasskey(facts, last.id)).rejects.toThrow("only passkey");
    expect(await m.prisma.passkey.count({ where: { userId: dad.userId } })).toBe(1);

    // Every refused attempt above left nothing in the log.
    const kinds = await m.prisma.signInEvent.findMany({ where: { subjectId: dad.personId }, orderBy: { createdAt: "asc" }, select: { kind: true } });
    expect(kinds.map((k) => k.kind)).toEqual(["PASSKEY_ADDED", "PASSKEY_REMOVED"]);
  });

  test("two removals at once can't leave none", async () => {
    const ticket = await m.my.createAddPasskeyTicket(await sessionOf(mom.jar));
    expect((await addPasskey(mom.jar, ticket, new SoftAuthenticator(RP_ID, ORIGIN))).status).toBe(200);
    const keys = await m.prisma.passkey.findMany({ where: { userId: mom.userId }, select: { id: true } });
    expect(keys).toHaveLength(2);
    const facts = await sessionOf(mom.jar);
    const results = await Promise.allSettled(keys.map((k) => m.my.removePasskey(facts, k.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await m.prisma.passkey.count({ where: { userId: mom.userId } })).toBe(1);
  });
});
