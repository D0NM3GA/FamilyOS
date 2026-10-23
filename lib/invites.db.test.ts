import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SoftAuthenticator } from "@/lib/test-support/soft-authenticator";
import { authCall, CookieJar, ORIGIN, RP_ID, scratchDatabase } from "@/lib/test-support/auth-harness";

/**
 * Phase 40.2b against a real database (`npm run test:db`), through Better Auth's own handler with
 * software passkeys: an invite makes exactly one sign-in, once, linked to the right person with
 * the invite's role; everything it depends on is checked again when it's used (the person, who
 * made it, the email), all or nothing; a signed-in browser can't use one. Starts from an empty
 * scratch database so it can set up its own family.
 */
const RUN = import.meta.env.MODE === "db";

type Modules = {
  auth: typeof import("@/lib/auth").auth;
  setup: typeof import("@/lib/setup");
  invites: typeof import("@/lib/invites");
  prisma: typeof import("@/lib/prisma").prisma;
};

describe.skipIf(!RUN)("invites (scratch database)", { timeout: 180_000 }, () => {
  const db = scratchDatabase("fos_invites");
  let m: Modules;
  const call = (jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) => authCall(m.auth, jar, path, init);

  const dadJar = new CookieJar();
  let dad: { id: string; householdId: string; firstName: string };
  let householdId = "";

  beforeAll(async () => {
    await db.create();
    m = {
      auth: (await import("@/lib/auth")).auth,
      setup: await import("@/lib/setup"),
      invites: await import("@/lib/invites"),
      prisma: (await import("@/lib/prisma")).prisma,
    };
    const token = await m.setup.createSetupToken({ householdName: "The Parkers", firstName: "Dad", email: "dad-invites@example.com" });
    const options = await (await call(dadJar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json();
    const res = await call(dadJar, "/passkey/verify-registration", { method: "POST", body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options), createSession: true } });
    expect(res.status).toBe(200);
    const user = await m.prisma.user.findUniqueOrThrow({ where: { email: "dad-invites@example.com" } });
    await m.setup.finishSetup({ id: user.id, email: user.email }, { householdName: "The Parkers", firstName: "Dad" });
    dad = await m.prisma.person.findUniqueOrThrow({ where: { authUserId: user.id }, select: { id: true, householdId: true, firstName: true } });
    householdId = dad.householdId;
  }, 150_000);

  afterAll(() => db.drop(m?.prisma), 60_000);

  async function member(firstName: string, role: "ADULT" | "ADMIN" | "KID" = "ADULT") {
    return m.prisma.person.create({ data: { householdId, firstName, lastName: "Parker", role, isHouseholdMember: true } });
  }

  /** Opens the invite signed out (or in `jar`) and makes a passkey; returns the verify response. */
  async function accept(token: string, { jar = new CookieJar(), userVerified = true } = {}) {
    const optionsRes = await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`);
    if (!optionsRes.ok) return { res: optionsRes, jar };
    const options = await optionsRes.json();
    const res = await call(jar, "/passkey/verify-registration", {
      method: "POST",
      body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options, { userVerified }), createSession: true },
    });
    return { res, jar };
  }

  test("an invite for someone on a PIN makes their sign-in, once, linked with the invite's role", async () => {
    const grandma = await member("Grandma");
    const token = await m.invites.createInvite(dad, { who: "member", personId: grandma.id, email: "grandma-invites@example.com", role: "ADULT" });
    expect(await m.invites.readInvite(token)).toMatchObject({ firstName: "Grandma", from: "Dad", email: "grandma-invites@example.com" });

    const { res, jar } = await accept(token);
    expect(res.status).toBe(200);
    expect(jar.has("session_token")).toBe(true);
    const user = await m.prisma.user.findUniqueOrThrow({ where: { email: "grandma-invites@example.com" }, include: { passkeys: true, person: true } });
    expect(user.passkeys).toHaveLength(1);
    expect(user.person).toMatchObject({ id: grandma.id, role: "ADULT", isHouseholdMember: true });
    expect(await m.prisma.invite.count({ where: { personId: grandma.id } })).toBe(0);
    const kinds = await m.prisma.signInEvent.findMany({ where: { subjectId: grandma.id }, orderBy: { createdAt: "asc" }, select: { kind: true } });
    expect(kinds.map((k) => k.kind)).toEqual(["INVITE_MADE", "INVITE_ACCEPTED"]);

    // Used up.
    expect((await accept(token)).res.status).toBe(403);
    expect(await m.prisma.user.count({ where: { email: "grandma-invites@example.com" } })).toBe(1);
  });

  test("an invite for someone new makes their person, as an admin if that's what it says", async () => {
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Grandpa", lastName: "Parker", email: "grandpa-invites@example.com", role: "ADMIN" });
    expect((await accept(token)).res.status).toBe(200);
    const user = await m.prisma.user.findUniqueOrThrow({ where: { email: "grandpa-invites@example.com" }, include: { person: true } });
    expect(user.person).toMatchObject({ firstName: "Grandpa", lastName: "Parker", role: "ADMIN", isHouseholdMember: true, householdId });
  });

  test("made-up, expired, or unverified: refused, and a live invite stays live", async () => {
    expect((await accept("made-up")).res.status).toBe(403);

    const mom = await member("Mom");
    const token = await m.invites.createInvite(dad, { who: "member", personId: mom.id, email: "mom-invites@example.com", role: "ADULT" });
    expect((await accept(token, { userVerified: false })).res.status).toBe(400);
    expect(await m.invites.readInvite(token)).not.toBeNull();

    await m.prisma.invite.updateMany({ where: { personId: mom.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(token)).res.status).toBe(403);
    expect(await m.prisma.user.count({ where: { email: "mom-invites@example.com" } })).toBe(0);
  });

  test("only grown-ups without a sign-in, and never an email that's someone's sign-in", async () => {
    const ivy = await member("Ivy", "KID");
    const grandma = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Grandma" } });
    const invite = (personId: string, email: string) => m.invites.createInvite(dad, { who: "member", personId, email, role: "ADULT" });
    await expect(invite(ivy.id, "ivy-invites@example.com")).rejects.toBeInstanceOf(m.invites.InviteError);
    await expect(invite(grandma.id, "grandma2-invites@example.com")).rejects.toBeInstanceOf(m.invites.InviteError);
    await expect(invite(dad.id, "dad2-invites@example.com")).rejects.toBeInstanceOf(m.invites.InviteError);
    const max = await member("Max", "ADULT");
    await expect(invite(max.id, "dad-invites@example.com")).rejects.toThrow("already belongs to a sign-in");
  });

  test("checked again when used: the person removed, made a kid, or linked elsewhere since", async () => {
    const mom = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Mom" } });
    const fresh = () => m.invites.createInvite(dad, { who: "member", personId: mom.id, email: "mom-invites@example.com", role: "ADULT" });

    let token = await fresh();
    await m.prisma.person.update({ where: { id: mom.id }, data: { isHouseholdMember: false } });
    expect((await accept(token)).res.status).toBe(403);
    await m.prisma.person.update({ where: { id: mom.id }, data: { isHouseholdMember: true } });

    token = await fresh();
    await m.prisma.person.update({ where: { id: mom.id }, data: { role: "KID" } });
    expect((await accept(token)).res.status).toBe(403);
    await m.prisma.person.update({ where: { id: mom.id }, data: { role: "ADULT" } });

    token = await fresh();
    // A Microsoft sign-in adopting her by email in the meantime (a real way in: an account row).
    const other = await m.prisma.user.create({ data: { name: "Mom", email: "mom-microsoft@example.com" } });
    await m.prisma.account.create({ data: { userId: other.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000dd" } });
    await m.prisma.person.update({ where: { id: mom.id }, data: { authUserId: other.id } });
    expect((await accept(token)).res.status).toBe(403);

    // All or nothing: no user, passkey or link was left behind by the refusals.
    expect(await m.prisma.user.count({ where: { email: "mom-invites@example.com" } })).toBe(0);
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: mom.id } })).authUserId).toBe(other.id);
  });

  test("an invite is only good while whoever made it is still an admin in the household", async () => {
    const grandpa = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Grandpa" }, select: { id: true, householdId: true, firstName: true } });
    let token = await m.invites.createInvite(grandpa, { who: "new", firstName: "Auntie", lastName: "Parker", email: "auntie-invites@example.com", role: "ADULT" });
    await m.prisma.person.update({ where: { id: grandpa.id }, data: { role: "ADULT" } });
    // The admin page says it won't work.
    expect((await m.invites.pendingInvites(householdId)).find((i) => i.firstName === "Auntie")).toMatchObject({ from: "Grandpa", usable: false });
    expect((await accept(token)).res.status).toBe(403);
    expect(await m.prisma.person.count({ where: { firstName: "Auntie" } })).toBe(0);

    // Back to admin, then out of the household: refused again.
    await m.prisma.person.update({ where: { id: grandpa.id }, data: { role: "ADMIN" } });
    await m.prisma.invite.deleteMany({ where: { email: "auntie-invites@example.com" } });
    token = await m.invites.createInvite(grandpa, { who: "new", firstName: "Auntie", lastName: "Parker", email: "auntie-invites@example.com", role: "ADULT" });
    await m.prisma.person.update({ where: { id: grandpa.id }, data: { isHouseholdMember: false } });
    expect((await accept(token)).res.status).toBe(403);
    expect(await m.prisma.person.count({ where: { firstName: "Auntie" } })).toBe(0);
    await m.prisma.person.update({ where: { id: grandpa.id }, data: { isHouseholdMember: true } });
  });

  test("two browsers using one invite at once make one sign-in", async () => {
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Uncle", lastName: "Parker", email: "uncle-invites@example.com", role: "ADULT" });
    const jars = [new CookieJar(), new CookieJar()];
    const options = await Promise.all(jars.map(async (jar) => (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json()));
    const results = await Promise.all(
      jars.map((jar, i) =>
        call(jar, "/passkey/verify-registration", { method: "POST", body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options[i]), createSession: true } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(await m.prisma.person.count({ where: { firstName: "Uncle" } })).toBe(1);
    expect(await m.prisma.passkey.count({ where: { user: { email: "uncle-invites@example.com" } } })).toBe(1);
  });

  test("a signed-in browser can't use an invite, and doesn't use it up", async () => {
    const token = await m.invites.createInvite(dad, { who: "new", firstName: "Cousin", lastName: "Parker", email: "cousin-invites@example.com", role: "ADULT" });
    const { res } = await accept(token, { jar: dadJar });
    expect(res.status).toBe(403);
    // Refused because a signed-in registration wants a My passkeys ticket, not because Dad's sign-in is old.
    expect((await res.json()).message).toMatch(/My passkeys/);
    expect(await m.invites.readInvite(token)).not.toBeNull();
    await m.prisma.invite.deleteMany({ where: { email: "cousin-invites@example.com" } });
  });

  test("cancelling, one invite per person, one per email, and the log", async () => {
    const max = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Max" } });
    const first = await m.invites.createInvite(dad, { who: "member", personId: max.id, email: "max-invites@example.com", role: "ADULT" });
    const second = await m.invites.createInvite(dad, { who: "member", personId: max.id, email: "max-invites@example.com", role: "ADULT" });
    expect(await m.invites.readInvite(first)).toBeNull();
    expect(await m.invites.readInvite(second)).not.toBeNull();
    await expect(m.invites.createInvite(dad, { who: "new", firstName: "Other", email: "max-invites@example.com", role: "ADULT" })).rejects.toThrow("already an invite waiting");

    const live = await m.prisma.invite.findFirstOrThrow({ where: { personId: max.id } });
    await m.invites.revokeInvite(dad, live.id);
    expect(await m.invites.readInvite(second)).toBeNull();
    expect((await accept(second)).res.status).toBe(403);
    await expect(m.invites.revokeInvite(dad, live.id)).rejects.toBeInstanceOf(m.invites.InviteError);
    expect(await m.prisma.signInEvent.findFirst({ where: { subjectId: max.id, kind: "INVITE_CANCELLED" } })).toMatchObject({ actorId: dad.id });
  });

  test("someone whose sign-in never got a passkey isn't the invite form's: Reset's 1-hour link puts them back on it", async () => {
    const grandma = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Grandma" } });
    const user = await m.prisma.user.findUniqueOrThrow({ where: { email: "grandma-invites@example.com" } });
    // What a failed passkey insert after the invite would leave: linked, no passkey.
    await m.prisma.passkey.deleteMany({ where: { userId: user.id } });
    expect((await m.invites.invitableMembers(householdId)).map((p) => p.id)).not.toContain(grandma.id);
    await expect(
      m.invites.createInvite(dad, { who: "member", personId: grandma.id, email: "someone-else-invites@example.com", role: "ADULT" }),
    ).rejects.toBeInstanceOf(m.invites.InviteError);

    const { resetPasskeys } = await import("@/lib/sign-ins");
    const { token } = await resetPasskeys(dad, grandma.id);
    expect((await accept(token)).res.status).toBe(200);
    expect(await m.prisma.user.count({ where: { email: "grandma-invites@example.com" } })).toBe(1);
    expect(await m.prisma.passkey.count({ where: { userId: user.id } })).toBe(1);
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: grandma.id } })).authUserId).toBe(user.id);
  });

  test("checked again when used: an email that became someone's sign-in is refused; one left with nothing is reused", async () => {
    let token = await m.invites.createInvite(dad, { who: "new", firstName: "Cousin", lastName: "Parker", email: "cousin-invites@example.com", role: "ADULT" });
    const taken = await m.prisma.user.create({ data: { name: "Cousin", email: "cousin-invites@example.com" } });
    await m.prisma.account.create({ data: { userId: taken.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000cc" } });
    expect((await accept(token)).res.status).toBe(409);
    expect(await m.prisma.person.count({ where: { firstName: "Cousin" } })).toBe(0);

    const orphan = await m.prisma.user.create({ data: { name: "Left over", email: "orphan-invites@example.com" } });
    token = await m.invites.createInvite(dad, { who: "new", firstName: "Auntie", lastName: "Example", email: "orphan-invites@example.com", role: "ADULT" });
    expect((await accept(token)).res.status).toBe(200);
    expect(await m.prisma.passkey.count({ where: { userId: orphan.id } })).toBe(1);
    expect((await m.prisma.person.findFirstOrThrow({ where: { lastName: "Example" } })).authUserId).toBe(orphan.id);
  });

  test("at most 20 waiting invites in a household", async () => {
    await m.prisma.invite.deleteMany({ where: { householdId } });
    for (let i = 0; i < 20; i++) {
      await m.invites.createInvite(dad, { who: "new", firstName: "Example", email: `cap-${i}-invites@example.com`, role: "ADULT" });
    }
    await expect(m.invites.createInvite(dad, { who: "new", firstName: "Example", email: "cap-20-invites@example.com", role: "ADULT" })).rejects.toThrow(
      "a lot of invites",
    );
  });

  test("expired invites are cleared", async () => {
    await m.prisma.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await m.invites.purgeExpiredInvites();
    expect(await m.prisma.invite.count()).toBe(0);
  });
});
