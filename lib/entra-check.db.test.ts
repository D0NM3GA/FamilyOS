import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runEntraCheck } from "@/lib/entra-check";
import { EntraGraphError, type EntraRole } from "@/lib/entra-graph";
import { workingAdmins } from "@/lib/sign-ins";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import { listAlertTargets } from "@/lib/alerts/targets";
import { entraAccess, entraSignIn } from "@/lib/active-profile";

/**
 * Phase 40.4 against a real database (`npm run test:db`): the Entra check with Entra's answer
 * given directly (lib/entra-graph.ts is unit-tested on its own). Roles follow Entra (unless a
 * newer sign-in disagrees), someone no longer assigned loses access on the first check, an ended
 * admin's invites and alerts stop, nothing changes on a bad read, and a run that would leave no
 * admin who can sign in is refused whole. Its own household, cleaned up after.
 */
const RUN = import.meta.env.MODE === "db";

const ENV = { MICROSOFT_CLIENT_ID: "11111111-2222-4333-8444-555555555555", MICROSOFT_CLIENT_SECRET: "x", MICROSOFT_TENANT_ID: "66666666-7777-4888-8999-000000000000", ALERT_MAILBOX: "alerts@example.com" };

const idToken = (roles: string[], iat: number) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ roles, iat })).toString("base64url")}.sig`;

describe.skipIf(!RUN)("checking Entra (database)", () => {
  const tag = `e2e-entra-${Date.now()}`;
  const saved: Record<string, string | undefined> = {};
  const ids = { h: "", dad: "", mom: "", grandpa: "", max: "", momUser: "", gpUser: "", users: [] as string[] };
  const oid = { mom: `${tag}-MOM-OID`, gp: `${tag}-gp-oid` };
  const run = (assigned: Record<string, EntraRole>, now = new Date()) =>
    runEntraCheck(ids.h, { readAssignments: async () => new Map(Object.entries(assigned).map(([k, v]) => [k.toLowerCase(), v])), now });
  const titles = async (personId: string) =>
    (await prisma.notification.findMany({ where: { recipientId: personId, kind: "SIGN_IN_CHANGED" }, orderBy: { createdAt: "asc" }, select: { title: true } })).map((n) => n.title);

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const h = await prisma.household.create({ data: { name: tag } });
    ids.h = h.id;
    const user = async (name: string) => {
      const u = await prisma.user.create({ data: { name, email: `${name.toLowerCase()}-${tag}@example.com` } });
      ids.users.push(u.id);
      return u.id;
    };
    const dadUser = await user("Dad");
    await prisma.passkey.create({ data: { userId: dadUser, credentialID: `${tag}-dad`, publicKey: "x", counter: 0, deviceType: "singleDevice", backedUp: false } });
    const maxUser = await user("Max");
    await prisma.passkey.create({ data: { userId: maxUser, credentialID: `${tag}-max`, publicKey: "x", counter: 0, deviceType: "singleDevice", backedUp: false } });
    ids.momUser = await user("Mom");
    ids.gpUser = await user("Grandpa");
    const old = Math.floor(Date.now() / 1000) - 7200;
    await prisma.account.create({ data: { userId: ids.momUser, providerId: "microsoft", accountId: oid.mom, idToken: idToken(["Adult"], old) } });
    await prisma.account.create({ data: { userId: ids.gpUser, providerId: "microsoft", accountId: oid.gp, idToken: idToken(["Admin"], old) } });
    const person = (firstName: string, role: "ADMIN" | "ADULT", authUserId: string) =>
      prisma.person.create({ data: { householdId: h.id, firstName, lastName: "Parker", role, isHouseholdMember: true, authUserId, email: `${firstName.toLowerCase()}-${tag}@example.com` } });
    ids.dad = (await person("Dad", "ADMIN", dadUser)).id;
    ids.max = (await person("Max", "ADULT", maxUser)).id;
    ids.mom = (await person("Mom", "ADULT", ids.momUser)).id;
    ids.grandpa = (await person("Grandpa", "ADMIN", ids.gpUser)).id;
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const snapshot = () => prisma.person.findMany({ where: { householdId: ids.h }, orderBy: { firstName: "asc" }, select: { firstName: true, role: true, entraAccessEndedAt: true } });

  test("everyone assigned as stored: nothing changes (object ids match whatever their case)", async () => {
    const before = await snapshot();
    expect(await run({ [oid.mom.toUpperCase()]: "ADULT", [oid.gp]: "ADMIN" })).toMatchObject({ outcome: "ok", changed: 0, ended: 0 });
    expect(await snapshot()).toEqual(before);
    expect((await prisma.entraCheck.findUniqueOrThrow({ where: { householdId: ids.h } })).lastOkAt).not.toBeNull();
  });

  test("a bad or empty read changes nothing", async () => {
    const before = await snapshot();
    const failing = (code: "permission" | "unavailable") =>
      runEntraCheck(ids.h, {
        readAssignments: async () => {
          throw new EntraGraphError(code);
        },
      });
    expect((await failing("permission")).outcome).toBe("permission");
    expect((await failing("unavailable")).outcome).toBe("unavailable");
    expect((await run({})).outcome).toBe("empty");
    expect(await snapshot()).toEqual(before);
    expect((await prisma.entraCheck.findUniqueOrThrow({ where: { householdId: ids.h } })).outcome).toBe("empty");
  });

  test("a role follows Entra, told to the person and the other admins; a newer sign-in that disagrees waits", async () => {
    expect(await run({ [oid.mom]: "ADMIN", [oid.gp]: "ADMIN" })).toMatchObject({ outcome: "ok", changed: 1 });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: ids.mom } })).role).toBe("ADMIN");
    expect(await titles(ids.mom)).toEqual(["🔐 Entra made you an admin."]);
    expect(await titles(ids.dad)).toEqual(["🔐 Entra made Mom an admin."]);
    expect(await prisma.signInEvent.findFirst({ where: { subjectId: ids.mom, kind: "ROLE_CHANGED" } })).toMatchObject({ actorId: null, actorName: "Entra", detail: "Admin" });

    // Mom signs in again and her token (newer than the last good check) says Admin; Entra's
    // directory, lagging, says Adult: nothing changes yet.
    const fresh = Math.floor(Date.now() / 1000) + 60;
    await prisma.account.updateMany({ where: { userId: ids.momUser }, data: { idToken: idToken(["Admin"], fresh) } });
    expect(await run({ [oid.mom]: "ADULT", [oid.gp]: "ADMIN" })).toMatchObject({ outcome: "ok", changed: 0 });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: ids.mom } })).role).toBe("ADMIN");
    // A check after that sign-in still waits (the last good one was before it); the next one,
    // with a good check behind it from after the sign-in, lets Entra win.
    expect(await run({ [oid.mom]: "ADULT", [oid.gp]: "ADMIN" }, new Date(Date.now() + 120_000))).toMatchObject({ outcome: "ok", changed: 0 });
    expect(await run({ [oid.mom]: "ADULT", [oid.gp]: "ADMIN" }, new Date(Date.now() + 180_000))).toMatchObject({ outcome: "ok", changed: 1 });
    const mom = await prisma.person.findUniqueOrThrow({ where: { id: ids.mom } });
    expect(mom.role).toBe("ADULT");
    // Her next page load, with that older Admin token, doesn't undo it (Fable's review).
    const { lastOkAt } = await prisma.entraCheck.findUniqueOrThrow({ where: { householdId: ids.h } });
    expect(entraAccess(mom, await entraSignIn(ids.momUser), lastOkAt)).toEqual({ kind: "none" });
  });

  test("an admin no longer assigned loses access on the first check: signed out, their invites gone, not an admin anywhere, told", async () => {
    await prisma.session.create({ data: { userId: ids.gpUser, token: `${tag}-gp-session`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.invite.create({
      data: { householdId: ids.h, tokenHash: `${tag}-hash`, email: `new-${tag}@example.com`, firstName: "Auntie", role: "ADULT", createdById: ids.grandpa, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await workingAdmins(prisma, ids.h)).toBe(2);
    await prisma.notification.deleteMany({ where: { householdId: ids.h } });

    expect(await run({ [oid.mom]: "ADULT" })).toMatchObject({ outcome: "ok", ended: 1 });
    const gp = await prisma.person.findUniqueOrThrow({ where: { id: ids.grandpa } });
    expect(gp.entraAccessEndedAt).not.toBeNull();
    expect(gp.authUserId).toBe(ids.gpUser); // still linked: a sign-in with a role brings them back
    expect(await prisma.session.count({ where: { userId: ids.gpUser } })).toBe(0);
    expect(await prisma.invite.count({ where: { createdById: ids.grandpa } })).toBe(0);
    expect(await workingAdmins(prisma, ids.h)).toBe(1);
    expect((await listAlertTargets(ids.h)).map((p) => p.id)).not.toContain(ids.grandpa);
    expect(await titles(ids.grandpa)).toEqual(["🔐 Your access to the app was ended in Entra (Microsoft 365). If that's a mistake, ask whoever looks after it."]);
    expect(await titles(ids.dad)).toEqual([
      "🔐 Entra ended Grandpa's access to the app. Invites or links Grandpa made stopped working, and a shared tablet signed in as Grandpa needs another grown-up's sign-in.",
    ]);
    expect(await prisma.signInEvent.findFirst({ where: { subjectId: ids.grandpa, kind: "ENTRA_ACCESS_ENDED" } })).toMatchObject({ actorName: "Entra" });

    // A second check doesn't end them again.
    expect(await run({ [oid.mom]: "ADULT" })).toMatchObject({ outcome: "ok", ended: 0 });
  });

  test("nothing leaves the app for someone Entra cut off, except their own sign-in notice", async () => {
    const n = await prisma.notification.create({ data: { householdId: ids.h, recipientId: ids.grandpa, kind: "ORDER_PLACED", title: "Ivy bought a sticker", href: "/points" } });
    const senders = { teams: vi.fn(async () => {}), email: vi.fn(async () => {}), push: vi.fn(async () => "ok" as const) };
    await deliverNotifications({ id: n.id }, { channels: "teams-first", alsoEmail: true }, senders);
    expect(senders.email).not.toHaveBeenCalled();
    await deliverNotifications({ id: n.id }, { channels: "teams-first", alsoEmail: true, includeEnded: true }, senders);
    expect(senders.email).toHaveBeenCalledTimes(1);
  });

  test("Phase 53: a run keeps the app's enterprise app id, for the Entra link (a GUID only)", async () => {
    const sp = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    const withSp = (id: string) =>
      runEntraCheck(ids.h, {
        readAssignments: async (seen) => {
          seen(id);
          return new Map([[oid.mom.toLowerCase(), "ADULT" as const]]);
        },
      });
    expect(await withSp(sp)).toMatchObject({ outcome: "ok", changed: 0, ended: 0 });
    expect((await prisma.entraCheck.findUniqueOrThrow({ where: { householdId: ids.h } })).servicePrincipalId).toBe(sp.toLowerCase());
    await withSp("not-a-guid");
    expect((await prisma.entraCheck.findUniqueOrThrow({ where: { householdId: ids.h } })).servicePrincipalId).toBe(sp.toLowerCase());
  });

  test("a run that would leave no admin who can sign in is refused whole", async () => {
    // Grandpa back, Dad no longer an admin: Grandpa is the only admin who can sign in.
    await prisma.person.update({ where: { id: ids.grandpa }, data: { entraAccessEndedAt: null } });
    await prisma.person.update({ where: { id: ids.dad }, data: { role: "ADULT" } });
    expect(await workingAdmins(prisma, ids.h)).toBe(1);
    const before = await snapshot();
    expect(await run({ [oid.mom]: "ADULT" })).toMatchObject({ outcome: "noAdmin", ended: 0 });
    expect(await snapshot()).toEqual(before);
    await prisma.person.update({ where: { id: ids.dad }, data: { role: "ADMIN" } });
  });

  test("one run at a time, and passkey people are never touched", async () => {
    await prisma.entraCheck.update({ where: { householdId: ids.h }, data: { leaseUntil: new Date(Date.now() + 60_000) } });
    expect((await run({ [oid.mom]: "ADULT", [oid.gp]: "ADMIN" })).outcome).toBe("busy");
    await prisma.entraCheck.update({ where: { householdId: ids.h }, data: { leaseUntil: null } });
    const people = await prisma.person.findMany({ where: { id: { in: [ids.dad, ids.max] } }, orderBy: { firstName: "asc" }, select: { role: true, entraAccessEndedAt: true } });
    expect(people).toEqual([
      { role: "ADMIN", entraAccessEndedAt: null },
      { role: "ADULT", entraAccessEndedAt: null },
    ]);
  });
});
