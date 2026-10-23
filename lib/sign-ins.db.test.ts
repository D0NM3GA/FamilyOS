import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SoftAuthenticator } from "@/lib/test-support/soft-authenticator";
import { authCall, CookieJar, ORIGIN, RP_ID, scratchDatabase } from "@/lib/test-support/auth-harness";

/**
 * Phase 40.2c against a real database (`npm run test:db`), through Better Auth's own handler with
 * software passkeys: an admin resets someone's passkeys (a 1-hour link back onto the same
 * sign-in), takes a sign-in away, or changes a role; at least one admin who can sign in is always
 * left, even with two admins acting on each other at once; the acting admin is checked again
 * under the lock; and the notices go to the right people (your own always, others' by switch).
 */
const RUN = import.meta.env.MODE === "db";

type Modules = {
  auth: typeof import("@/lib/auth").auth;
  setup: typeof import("@/lib/setup");
  invites: typeof import("@/lib/invites");
  signIns: typeof import("@/lib/sign-ins");
  notices: typeof import("@/lib/sign-in-notices");
  my: typeof import("@/lib/my-passkeys");
  prisma: typeof import("@/lib/prisma").prisma;
};

type Admin = { id: string; householdId: string; firstName: string };

describe.skipIf(!RUN)("managing sign-ins (scratch database)", { timeout: 180_000 }, () => {
  const db = scratchDatabase("fos_signins");
  let m: Modules;
  const call = (jar: CookieJar, path: string, init: { method?: string; body?: unknown } = {}) => authCall(m.auth, jar, path, init);

  const people: Record<"dad" | "mom" | "grandpa", { device: SoftAuthenticator; userId: string; person: Admin }> = {
    dad: { device: new SoftAuthenticator(RP_ID, ORIGIN), userId: "", person: { id: "", householdId: "", firstName: "Dad" } },
    mom: { device: new SoftAuthenticator(RP_ID, ORIGIN), userId: "", person: { id: "", householdId: "", firstName: "Mom" } },
    grandpa: { device: new SoftAuthenticator(RP_ID, ORIGIN), userId: "", person: { id: "", householdId: "", firstName: "Grandpa" } },
  };
  let householdId = "";

  async function setupUser(name: keyof typeof people) {
    const email = `${name}-signins@example.com`;
    const token = await m.setup.createSetupToken({ householdName: "The Parkers", firstName: people[name].person.firstName, email });
    const jar = new CookieJar();
    const options = await (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`)).json();
    expect((await call(jar, "/passkey/verify-registration", { method: "POST", body: { response: people[name].device.register(options), createSession: true } })).status).toBe(200);
    people[name].userId = (await m.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  beforeAll(async () => {
    await db.create();
    m = {
      auth: (await import("@/lib/auth")).auth,
      setup: await import("@/lib/setup"),
      invites: await import("@/lib/invites"),
      signIns: await import("@/lib/sign-ins"),
      notices: await import("@/lib/sign-in-notices"),
      my: await import("@/lib/my-passkeys"),
      prisma: (await import("@/lib/prisma")).prisma,
    };
    await setupUser("dad");
    await setupUser("mom");
    await setupUser("grandpa");
    await m.setup.finishSetup({ id: people.dad.userId, email: "dad-signins@example.com" }, { householdName: "The Parkers", firstName: "Dad" });
    householdId = (await m.prisma.household.findFirstOrThrow()).id;
    people.dad.person = { id: (await m.prisma.person.findUniqueOrThrow({ where: { authUserId: people.dad.userId } })).id, householdId, firstName: "Dad" };
    for (const [name, role] of [["mom", "ADULT"], ["grandpa", "ADMIN"]] as const) {
      const p = await m.prisma.person.create({
        data: { householdId, firstName: people[name].person.firstName, lastName: "Parker", role, isHouseholdMember: true, authUserId: people[name].userId },
      });
      people[name].person = { id: p.id, householdId, firstName: p.firstName };
    }
  }, 150_000);

  afterAll(() => db.drop(m?.prisma), 60_000);

  async function signInWith(device: SoftAuthenticator) {
    const jar = new CookieJar();
    const options = await (await call(jar, "/passkey/generate-authenticate-options")).json();
    const res = await call(jar, "/passkey/verify-authentication", { method: "POST", body: { response: device.signIn(options) } });
    return { res, jar };
  }

  async function accept(token: string, device: SoftAuthenticator) {
    const jar = new CookieJar();
    const optionsRes = await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(token)}`);
    if (!optionsRes.ok) return { res: optionsRes, jar };
    const options = await optionsRes.json();
    const res = await call(jar, "/passkey/verify-registration", { method: "POST", body: { response: device.register(options), createSession: true } });
    return { res, jar };
  }

  const titlesFor = async (personId: string) =>
    (await m.prisma.notification.findMany({ where: { recipientId: personId, kind: "SIGN_IN_CHANGED" }, orderBy: { createdAt: "asc" }, select: { title: true } })).map(
      (n) => n.title,
    );

  test("a reset clears the passkeys and sessions, and its 1-hour link brings them back onto the same sign-in, once", async () => {
    const { dad, mom, grandpa } = people;
    expect((await signInWith(mom.device)).res.status).toBe(200);
    const before = Date.now();
    const { token } = await m.signIns.resetPasskeys(dad.person, mom.person.id);
    expect(await m.prisma.passkey.count({ where: { userId: mom.userId } })).toBe(0);
    expect(await m.prisma.session.count({ where: { userId: mom.userId } })).toBe(0);
    expect((await signInWith(mom.device)).res.status).not.toBe(200);

    const invite = await m.prisma.invite.findFirstOrThrow({ where: { personId: mom.person.id } });
    expect(invite.expiresAt.getTime() - before).toBeLessThanOrEqual(3_600_000 + 5_000);
    expect(await m.invites.readInvite(token)).toMatchObject({ firstName: "Mom", recovery: true });
    // While she's reset she isn't offered for a 48-hour invite: Reset's link is the way back.
    expect((await m.invites.invitableMembers(householdId)).map((p) => p.id)).not.toContain(mom.person.id);

    const newPhone = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await accept(token, newPhone)).res.status).toBe(200);
    expect(await m.prisma.user.count({ where: { email: "mom-signins@example.com" } })).toBe(1);
    expect(await m.prisma.passkey.count({ where: { userId: mom.userId } })).toBe(1);
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: mom.person.id } })).authUserId).toBe(mom.userId);
    expect((await accept(token, new SoftAuthenticator(RP_ID, ORIGIN))).res.status).toBe(403);
    mom.device = newPhone;

    const kinds = (await m.prisma.signInEvent.findMany({ where: { subjectId: mom.person.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((k) => k.kind);
    expect(kinds).toEqual(["PASSKEYS_RESET", "INVITE_ACCEPTED"]);
    // Mom (always) and the other admin are told about the reset, not Dad who did it; Dad, who
    // holds the link, hears when it's used (how a link someone else used would show).
    expect(await titlesFor(mom.person.id)).toEqual(["🔐 Dad reset your passkeys. If you didn't ask for that, tell another grown-up."]);
    expect(await titlesFor(grandpa.person.id)).toEqual(["🔐 Dad reset Mom's passkeys."]);
    expect(await titlesFor(dad.person.id)).toEqual(["🔐 Mom used the new sign-in link and is back in. If Mom didn't, reset again."]);
  });

  test("a reset link is good for an hour", async () => {
    const { token } = await m.signIns.resetPasskeys(people.dad.person, people.mom.person.id);
    await m.prisma.invite.updateMany({ where: { personId: people.mom.person.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(token, new SoftAuthenticator(RP_ID, ORIGIN))).res.status).toBe(403);
    // Back in for the tests below.
    const again = await m.signIns.resetPasskeys(people.dad.person, people.mom.person.id);
    const phone = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await accept(again.token, phone)).res.status).toBe(200);
    people.mom.device = phone;
  });

  test("not for yourself, and not for someone on Microsoft", async () => {
    await expect(m.signIns.resetPasskeys(people.dad.person, people.dad.person.id)).rejects.toMatchObject({ code: "self" });
    const user = await m.prisma.user.create({ data: { name: "Grandma", email: "grandma-signins@example.com" } });
    await m.prisma.account.create({ data: { userId: user.id, providerId: "microsoft", accountId: "00000000-0000-4000-8000-0000000000ee" } });
    const grandma = await m.prisma.person.create({ data: { householdId, firstName: "Grandma", role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    for (const run of [
      () => m.signIns.resetPasskeys(people.dad.person, grandma.id),
      () => m.signIns.removeSignIn(people.dad.person, grandma.id),
      () => m.signIns.changeRole(people.dad.person, grandma.id, "ADMIN"),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: "gone" });
    }
    expect(await m.prisma.account.count({ where: { userId: user.id } })).toBe(1);
    expect((await m.signIns.managedPeople(householdId, people.dad.person.id)).map((p) => p.firstName)).not.toContain("Grandma");
  });

  test("a role change takes, and a waiting link carries the new role", async () => {
    const { dad, mom } = people;
    await m.signIns.changeRole(dad.person, mom.person.id, "ADMIN");
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: mom.person.id } })).role).toBe("ADMIN");
    expect(await titlesFor(mom.person.id)).toContain("🔐 Dad made you an admin.");

    const { token } = await m.signIns.resetPasskeys(dad.person, mom.person.id);
    await m.signIns.changeRole(dad.person, mom.person.id, "ADULT");
    expect((await m.prisma.invite.findFirstOrThrow({ where: { personId: mom.person.id } })).role).toBe("ADULT");
    const phone = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await accept(token, phone)).res.status).toBe(200);
    people.mom.device = phone;
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: mom.person.id } })).role).toBe("ADULT");
  });

  test("an admin who stopped being one a moment ago can't change anyone", async () => {
    await m.prisma.person.update({ where: { id: people.grandpa.person.id }, data: { role: "ADULT" } });
    await expect(m.signIns.resetPasskeys(people.grandpa.person, people.mom.person.id)).rejects.toMatchObject({ code: "notAdmin" });
    expect(await m.prisma.passkey.count({ where: { userId: people.mom.userId } })).toBe(1);
    await m.prisma.person.update({ where: { id: people.grandpa.person.id }, data: { role: "ADMIN" } });
  });

  test("two admins resetting each other at once leave one who can sign in", async () => {
    const { dad, grandpa } = people;
    const results = await Promise.allSettled([m.signIns.resetPasskeys(dad.person, grandpa.person.id), m.signIns.resetPasskeys(grandpa.person, dad.person.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: expect.stringMatching(/^(lastAdmin|notAdmin)$/) });
    expect(await m.signIns.workingAdmins(m.prisma, householdId)).toBe(1);

    // Whoever was reset gets back in.
    const resetOne = (await m.prisma.passkey.count({ where: { userId: dad.userId } })) === 0 ? "dad" : "grandpa";
    const fulfilled = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ token: string }>;
    const phone = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await accept(fulfilled.value.token, phone)).res.status).toBe(200);
    people[resetOne].device = phone;
  });

  test("taking a sign-in away: a PIN profile again, an adult, with their own-tile PIN gone; never a jar member's", async () => {
    const { dad, mom, grandpa } = people;
    const jar = await m.prisma.moneyJar.create({ data: { householdId, name: "Family" } });
    await m.prisma.moneyJarMember.create({ data: { jarId: jar.id, personId: mom.person.id } });
    await expect(m.signIns.removeSignIn(dad.person, mom.person.id)).rejects.toMatchObject({ code: "jarMember" });
    expect((await m.signIns.managedPeople(householdId, dad.person.id)).find((p) => p.id === mom.person.id)).toMatchObject({ inJar: true });

    await m.prisma.person.update({ where: { id: grandpa.person.id }, data: { pinHash: "own-tile-lock", pinFailedAttempts: 2 } });
    await m.signIns.removeSignIn(dad.person, grandpa.person.id);
    // pinHash is left out of reads unless asked for (lib/prisma.ts).
    const after = await m.prisma.person.findUniqueOrThrow({
      where: { id: grandpa.person.id },
      select: { authUserId: true, role: true, pinHash: true, pinFailedAttempts: true, isHouseholdMember: true },
    });
    expect(after).toMatchObject({ authUserId: null, role: "ADULT", pinHash: null, pinFailedAttempts: 0, isHouseholdMember: true });
    expect(await m.prisma.user.count({ where: { id: grandpa.userId } })).toBe(0);
    expect(await m.prisma.passkey.count({ where: { userId: grandpa.userId } })).toBe(0);
    expect((await signInWith(grandpa.device)).res.status).not.toBe(200);
    expect(await titlesFor(grandpa.person.id)).toContain("🔐 Dad took away your own sign-in. Your profile opens with a PIN now.");
    // He's someone you can invite again now.
    expect((await m.invites.invitableMembers(householdId)).map((p) => p.id)).toContain(grandpa.person.id);
  });

  test("never the last admin who can sign in", async () => {
    const { dad, mom } = people;
    await m.prisma.person.update({ where: { id: mom.person.id }, data: { role: "ADMIN" } });
    // Mom resets Dad: then only Mom can sign in as an admin, which is fine.
    const { token } = await m.signIns.resetPasskeys(mom.person, dad.person.id);
    // Now Mom can't demote... herself (not allowed), and Dad, signed out with no passkey, isn't a working admin.
    await expect(m.signIns.changeRole(dad.person, mom.person.id, "ADULT")).rejects.toMatchObject({ code: "lastAdmin" });
    expect((await m.prisma.person.findUniqueOrThrow({ where: { id: mom.person.id } })).role).toBe("ADMIN");
    const phone = new SoftAuthenticator(RP_ID, ORIGIN);
    expect((await accept(token, phone)).res.status).toBe(200);
    people.dad.device = phone;
  });

  test("notices: the switch quiets others' sign-ins, never your own; a passkey you add and an invite you made being used", async () => {
    const { dad, mom } = people;
    await m.prisma.notification.deleteMany({});
    await m.notices.setOthersSignInNotices(mom.person.id, false);
    expect(await m.notices.othersSignInNoticesOn(mom.person.id)).toBe(false);
    // Mom (an admin) has her switch off: Dad changing someone else doesn't reach her.
    const newcomer = await m.invites.createInvite(dad.person, { who: "new", firstName: "Auntie", lastName: "Parker", email: "auntie-signins@example.com", role: "ADULT" });
    const auntieDevice = new SoftAuthenticator(RP_ID, ORIGIN);
    const { res, jar } = await accept(newcomer, auntieDevice);
    expect(res.status).toBe(200);
    expect(await titlesFor(dad.person.id)).toEqual(["🔐 Auntie used your invite and can sign in now."]);
    const auntie = await m.prisma.person.findFirstOrThrow({ where: { firstName: "Auntie" } });
    await m.signIns.changeRole(dad.person, auntie.id, "ADMIN");
    expect(await titlesFor(mom.person.id)).toEqual([]);
    expect(await titlesFor(auntie.id)).toEqual(["🔐 Dad made you an admin."]);

    // ...but a change to her own sign-in always does.
    await m.signIns.changeRole(dad.person, mom.person.id, "ADULT");
    expect(await titlesFor(mom.person.id)).toEqual(["🔐 Dad made you a grown-up without admin."]);

    // A passkey Auntie adds to her own sign-in: she's told, even though she did it.
    const body = await (await call(jar, "/get-session")).json();
    const ticket = await m.my.createAddPasskeyTicket({ id: body.session.id, userId: body.user.id, createdAt: body.session.createdAt });
    const options = await (await call(jar, `/passkey/generate-register-options?context=${encodeURIComponent(ticket)}`)).json();
    expect((await call(jar, "/passkey/verify-registration", { method: "POST", body: { response: new SoftAuthenticator(RP_ID, ORIGIN).register(options) } })).status).toBe(200);
    expect(await titlesFor(auntie.id)).toContain("🔐 A passkey was added to your sign-in. If that wasn't you, tell an admin.");
  });
});
