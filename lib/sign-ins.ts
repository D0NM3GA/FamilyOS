import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { microsoftConfigFrom } from "@/lib/microsoft-config";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";
import { oidcSignIn } from "@/lib/auth";
import { createInviteIn, InviteError, TOO_MANY_INVITES } from "@/lib/invites";
import { recordSignInEvent } from "@/lib/sign-in-events";
import { writeSignInNotices, type Announced } from "@/lib/sign-in-notices";

/**
 * Phase 40.2c: an admin looks after the other grown-ups who sign in with a passkey (Settings →
 * Sign-in): their role, resetting their passkeys when a phone is lost, taking their sign-in
 * away. Phase 40.3: and those on the install's OIDC provider (role and taking it away; there are
 * no passkeys to reset, and no Entra to do it for us). People on Microsoft are Entra's; your own
 * sign-in is My passkeys' (and another admin's).
 *
 * Each change runs in one transaction under the household's lock, and inside it: the acting
 * admin is checked again (another admin may have just changed them), the change is made, at
 * least one admin who can actually sign in must be left (counted from the data, so two admins
 * acting on each other at once can't leave none), and it's logged and announced
 * (lib/sign-in-notices.ts). Resetting someone lets the admin hold their way back in, across
 * the money-jar boundary: the owner's call (2026-10-13), with a 1-hour link, the audit log and
 * notices the person can't switch off.
 */

export const RECOVERY_HOURS = 1;

export const SIGN_IN_ERRORS = {
  notAdmin: "Only an admin, on their own profile, can do that.",
  stale: "Sign in again first.",
  self: "That's you: your own passkeys are in My passkeys, and another admin can change your sign-in.",
  gone: "They don't have a sign-in here that's yours to change anymore.",
  provider: "They sign in with the family's provider, so there are no passkeys to reset.",
  lastAdmin: "That would leave no admin who can sign in.",
  jarMember: "They're in a money jar, which needs their own sign-in. Take them out of their jars first.",
  noEmail: "Their sign-in has no email to make a new link with.",
  invites: "There are a lot of invites waiting. Cancel some first.",
} as const;
export type SignInErrorCode = keyof typeof SIGN_IN_ERRORS;

/** Fixed words by code: the page shows them by code, never text from a URL. */
export class SignInAdminError extends Error {
  constructor(readonly code: SignInErrorCode) {
    super(SIGN_IN_ERRORS[code]);
  }
}

type Tx = Prisma.TransactionClient;
type Admin = { id: string; householdId: string; firstName: string };
type Role = "ADULT" | "ADMIN";
const roleLabel = (role: Role) => (role === "ADMIN" ? "Admin" : "Adult");

/** Microsoft people are Entra's; any other sign-in of someone else's is an admin's here. */
const NOT_MICROSOFT = { accounts: { none: { providerId: "microsoft" } } };

/** The grown-ups an admin manages here: a passkey or OIDC sign-in, everyone but themselves. */
export async function managedPeople(householdId: string, exceptId: string) {
  const rows = await prisma.person.findMany({
    where: {
      householdId,
      isHouseholdMember: true,
      role: { in: ["ADULT", "ADMIN"] },
      id: { not: exceptId },
      authUserId: { not: null },
      authUser: { is: NOT_MICROSOFT },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      authUser: { select: { _count: { select: { passkeys: true } }, accounts: { where: { providerId: OIDC_PROVIDER_ID }, select: { id: true } } } },
      _count: { select: { moneyJars: true } },
    },
    orderBy: { firstName: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    role: r.role as Role,
    passkeys: r.authUser?._count.passkeys ?? 0,
    /** Signs in with the OIDC provider: nothing to reset. */
    provider: (r.authUser?.accounts.length ?? 0) > 0,
    // Jars need their own sign-in, so it can't be taken away (just counted, never named).
    inJar: r._count.moneyJars > 0,
  }));
}

/**
 * Admins who can actually sign in: a passkey, or a Microsoft account while Microsoft is on, or an
 * OIDC account while that provider is on (40.3). A reset admin (no passkey yet) doesn't count,
 * and nor does the dev sign-in's (never linked).
 */
export async function workingAdmins(tx: Tx | typeof prisma, householdId: string): Promise<number> {
  const ways: Prisma.UserWhereInput[] = [{ passkeys: { some: {} } }];
  if (microsoftConfigFrom(process.env) !== null) ways.push({ accounts: { some: { providerId: "microsoft" } } });
  if (await oidcSignIn()) ways.push({ accounts: { some: { providerId: OIDC_PROVIDER_ID } } });
  // Phase 40.4: never someone Entra has cut off.
  return tx.person.count({ where: { householdId, isHouseholdMember: true, role: "ADMIN", entraAccessEndedAt: null, authUser: { is: { OR: ways } } } });
}

const targetSelect = {
  id: true,
  firstName: true,
  role: true,
  authUserId: true,
  authUser: { select: { email: true, accounts: { select: { providerId: true } } } },
  _count: { select: { moneyJars: true } },
} as const;
type Target = Prisma.PersonGetPayload<{ select: typeof targetSelect }> & { authUserId: string };

/** One change to someone else's passkey sign-in, with every check that has to hold around it. */
async function managing<T>(actor: Admin, personId: string, change: (tx: Tx, target: Target) => Promise<T>): Promise<T> {
  if (personId === actor.id) throw new SignInAdminError("self");
  // Known before the lock: the first answer can wait on the provider (workingAdmins asks again).
  await oidcSignIn();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"signins:" + actor.householdId}))`;
    const stillAdmin = await tx.person.count({
      where: { id: actor.id, householdId: actor.householdId, isHouseholdMember: true, role: "ADMIN", authUserId: { not: null }, entraAccessEndedAt: null },
    });
    if (!stillAdmin) throw new SignInAdminError("notAdmin");
    const target = await tx.person.findFirst({
      where: { id: personId, householdId: actor.householdId, isHouseholdMember: true, role: { in: ["ADULT", "ADMIN"] }, authUserId: { not: null } },
      select: targetSelect,
    });
    // Microsoft people are Entra's (and any other provider but our OIDC one isn't ours either).
    if (!target || !target.authUserId || !target.authUser || target.authUser.accounts.some((a) => a.providerId !== OIDC_PROVIDER_ID)) {
      throw new SignInAdminError("gone");
    }
    const result = await change(tx, target as Target);
    if ((await workingAdmins(tx, actor.householdId)) === 0) throw new SignInAdminError("lastAdmin");
    return result;
  });
}

export type { Announced };

/** Adult ↔ Admin for a passkey person. A waiting recovery link for them carries the new role too. */
export async function changeRole(actor: Admin, personId: string, role: Role): Promise<Announced> {
  return managing(actor, personId, async (tx, target) => {
    if (target.role === role) return { subjectNotices: [], otherNotices: [] };
    await tx.person.update({ where: { id: target.id }, data: { role } });
    // Otherwise a link made before (as Admin) would put the old role back when it's used.
    await tx.invite.updateMany({ where: { personId: target.id }, data: { role } });
    const subject = { id: target.id, firstName: target.firstName };
    await recordSignInEvent(tx, { householdId: actor.householdId, kind: "ROLE_CHANGED", actor, subject, detail: roleLabel(role) });
    return writeSignInNotices(tx, { householdId: actor.householdId, kind: "ROLE_CHANGED", actor, subject, role: roleLabel(role) });
  });
}

/**
 * Lost phone: clears their passkeys and signs them out everywhere, then makes a recovery link
 * (a 1-hour invite onto the same sign-in: lib/invites.ts), all or nothing. Returns the link's
 * token, shown once to the admin.
 */
export async function resetPasskeys(actor: Admin, personId: string, now: Date = new Date()): Promise<{ token: string } & Announced> {
  return managing(actor, personId, async (tx, target) => {
    // OIDC people have no passkeys; their way back is the provider (40.3).
    if (target.authUser?.accounts.length) throw new SignInAdminError("provider");
    const email = target.authUser?.email;
    if (!email) throw new SignInAdminError("noEmail");
    await tx.passkey.deleteMany({ where: { userId: target.authUserId } });
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
    await tx.invite.deleteMany({ where: { personId: target.id } });
    let token: string;
    try {
      token = await createInviteIn(
        tx,
        actor,
        { who: "member", personId: target.id, email, role: target.role as Role },
        { hours: RECOVERY_HOURS, recovery: true, now },
      );
    } catch (e) {
      if (e instanceof InviteError) throw new SignInAdminError(e.message === TOO_MANY_INVITES ? "invites" : "gone");
      throw e;
    }
    const subject = { id: target.id, firstName: target.firstName };
    await recordSignInEvent(tx, { householdId: actor.householdId, kind: "PASSKEYS_RESET", actor, subject });
    const announced = await writeSignInNotices(tx, { householdId: actor.householdId, kind: "PASSKEYS_RESET", actor, subject });
    return { token, ...announced };
  });
}

/**
 * Takes someone's own sign-in away: they're a PIN profile again (and can then leave the
 * household as Phase 38 allows). Not for a money-jar member (jars need their own sign-in). An
 * admin becomes an adult: a PIN must never open an admin. Their own-tile PIN goes too: it was
 * chosen to lock their tile on their own sign-in, not to open their profile from anyone's.
 */
export async function removeSignIn(actor: Admin, personId: string): Promise<Announced> {
  return managing(actor, personId, async (tx, target) => {
    // Inside the lock and the transaction, so a jar added a moment ago is seen.
    if ((await tx.moneyJarMember.count({ where: { personId: target.id } })) > 0) throw new SignInAdminError("jarMember");
    await tx.person.update({
      where: { id: target.id },
      data: { role: "ADULT", pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await tx.invite.deleteMany({ where: { personId: target.id } });
    // Sessions and passkeys go with the user; the person's link is cleared by the foreign key.
    await tx.user.delete({ where: { id: target.authUserId } });
    const subject = { id: target.id, firstName: target.firstName };
    await recordSignInEvent(tx, { householdId: actor.householdId, kind: "SIGN_IN_REMOVED", actor, subject });
    return writeSignInNotices(tx, { householdId: actor.householdId, kind: "SIGN_IN_REMOVED", actor, subject });
  });
}
