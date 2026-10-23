import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSignInEvent } from "@/lib/sign-in-events";
import { writeInviteUsedNotice } from "@/lib/sign-in-notices";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";

/**
 * Phase 40.2b: an admin invites a grown-up to sign in on their own, with a passkey: someone in
 * the household on a PIN (Grandma), or someone new. The invite is a link with a single-use
 * token (stored hashed, 48 hours), shown to the admin once to hand over. Opening it signed out
 * and making a passkey creates their sign-in and links it to their person, in one transaction
 * that checks everything again (lib/passkey-hooks.ts calls acceptInvite):
 *
 * - the invite is live, and used up here, once;
 * - whoever made it is still an admin in the household;
 * - the email isn't someone else's sign-in (a user left with nothing is reused, as setup does);
 * - an existing person is still a grown-up household member with no way in of their own (they
 *   may have been removed, made a kid, or signed in with Microsoft since);
 * - a new person is created as a household member with the invite's role.
 *
 * People with Microsoft (or, later, another provider) just sign in with it; an invite is for
 * everyone else. Once someone has their own sign-in, their tile opens only with it, not a PIN.
 */

export const INVITE_HOURS = 48;
const MAX_LIVE_INVITES = 20;

const email = z.string().trim().toLowerCase().max(254).email("That email doesn't look right.");
const role = z.enum(["ADULT", "ADMIN"]);

export const inviteSchema = z.discriminatedUnion("who", [
  z.object({ who: z.literal("member"), personId: z.string().min(1, "Pick who to invite.").max(40), email, role }),
  z.object({
    who: z.literal("new"),
    firstName: z.string().trim().min(1, "Their first name, please.").max(40, "Keep the first name to 40 characters."),
    lastName: z.string().trim().max(60).optional(),
    email,
    role,
  }),
]);
export type InviteInput = z.infer<typeof inviteSchema>;

/** Fixed text, safe to show; `status` is what the passkey route answers with, `code` what a page's ?error= carries. */
export class InviteError extends Error {
  constructor(
    message: string,
    readonly status: "FORBIDDEN" | "CONFLICT" = "FORBIDDEN",
    readonly code: InviteErrorCode = "gone",
  ) {
    super(message);
  }
}

export const INVITE_GONE = "This invite has expired or was already used. Ask whoever sent it for a new one.";

/**
 * Phase 40.3: an invite page's refusals by code (the URL carries the code, never the words). Also
 * the words for Better Auth's own provider errors, which come back to the invite page.
 */
export const INVITE_ERRORS = {
  gone: INVITE_GONE,
  maker: "This invite is no longer good. Ask an admin for a new one.",
  taken: "That email already belongs to a sign-in here. Ask an admin.",
  unverified: "Your provider didn't confirm that account's email address, so the invite can't use it. Make a passkey instead.",
  mismatch: "That account's email isn't the one this invite was made for. Use that address at the provider, or make a passkey instead.",
  recovery: "This link makes a new passkey, so it can't be used with another sign-in.",
  provider: "That didn't work. Try again, or make a passkey instead.",
} as const;
export type InviteErrorCode = keyof typeof INVITE_ERRORS;
const inviteError = (code: InviteErrorCode, status: "FORBIDDEN" | "CONFLICT" = "FORBIDDEN") => new InviteError(INVITE_ERRORS[code], status, code);
export const TOO_MANY_INVITES = "There are a lot of invites waiting. Cancel some first.";
/** The audit detail that marks a reset's link (lib/sign-in-events.ts words it). */
export const RECOVERY_DETAIL = "recovery";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

type Admin = { id: string; householdId: string; firstName: string };

/**
 * A sign-in with no passkey and no provider account is no way in: the plugin's passkey insert
 * runs after acceptInvite has linked the person (its Prisma adapter has no transactions), so a
 * failed insert leaves exactly that (Fable's review), and so does a reset (40.2c). Such a person
 * gets back in with a recovery invite from Reset (lib/sign-ins.ts), onto the same sign-in.
 */
const NO_WAY_IN = { passkeys: { none: {} }, accounts: { none: {} } } as const;
const WITHOUT_OWN_WAY_IN = { OR: [{ authUserId: null }, { authUser: { is: NO_WAY_IN } }] };
const roleLabel = (role: "ADULT" | "ADMIN" | "KID") => (role === "ADMIN" ? "Admin" : "Adult");

type Tx = Prisma.TransactionClient;

/**
 * Phase 40.3: a sign-in that never became anyone: no person, no passkey, and no account but (at
 * most) one at the install's OIDC provider, from a provider sign-up that never finished. It can't
 * get in (no person), so it's cleared when its email is invited again, and after an hour anyway.
 */
const ORPHAN: Prisma.UserWhereInput = { person: null, passkeys: { none: {} }, accounts: { none: { providerId: { not: OIDC_PROVIDER_ID } } } };

/** Whether `address` is someone's way in (a user with a passkey or provider account, or one linked to another person). */
async function emailTaken(tx: Tx, address: string, forPersonId: string | null): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { email: address },
    select: { person: { select: { id: true } }, _count: { select: { passkeys: true } }, accounts: { select: { providerId: true } } },
  });
  if (!user) return false;
  // A provider sign-in that never became anyone isn't a way in (cleared before it's used again).
  const orphan = !user.person && user._count.passkeys === 0 && user.accounts.every((a) => a.providerId === OIDC_PROVIDER_ID);
  if (orphan) return false;
  return user._count.passkeys > 0 || user.accounts.length > 0 || (user.person !== null && user.person.id !== forPersonId);
}

/** Makes an invite; returns the token (the only copy; the link is `/invite/<token>`). */
export async function createInvite(admin: Admin, input: InviteInput, now: Date = new Date()): Promise<string> {
  return prisma.$transaction((tx) => createInviteIn(tx, admin, input, { now }));
}

export type InviteOptions = {
  /** How long it lasts: INVITE_HOURS, or 1 for a reset's recovery link. */
  hours?: number;
  /**
   * A reset's recovery invite (lib/sign-ins.ts): for someone whose sign-in has no way in left,
   * onto that same sign-in. Logged as the reset, not as an invite.
   */
  recovery?: boolean;
  now?: Date;
};

/**
 * Makes an invite inside the caller's transaction (a reset makes its recovery invite in the same
 * one as clearing the passkeys). Invites in one household take turns under a lock, so the cap and
 * the one-per-email rule hold; a reset takes its own lock first, always in that order.
 */
export async function createInviteIn(tx: Tx, admin: Admin, input: InviteInput, { hours = INVITE_HOURS, recovery = false, now = new Date() }: InviteOptions = {}): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invites:" + admin.householdId}))`;
  if (await emailTaken(tx, input.email, input.who === "member" ? input.personId : null)) {
    throw new InviteError("That email already belongs to a sign-in here.");
  }
  const token = randomBytes(32).toString("base64url");
  let subject: { id: string | null; firstName: string };
  if (input.who === "member") {
    // An invite is for someone with no sign-in at all; a recovery invite, for someone whose
    // sign-in has no way in left (Reset).
    const signIn = recovery ? { authUserId: { not: null }, authUser: { is: NO_WAY_IN } } : { authUserId: null };
    const person = await tx.person.findFirst({
      where: { id: input.personId, householdId: admin.householdId, isHouseholdMember: true, role: { in: ["ADULT", "ADMIN"] }, ...signIn },
      select: { id: true, firstName: true },
    });
    if (!person) throw new InviteError("Only a grown-up in the household without a sign-in of their own can be invited.");
    // One live invite per person: a new one replaces the last.
    await tx.invite.deleteMany({ where: { personId: person.id } });
    subject = person;
  } else {
    subject = { id: null, firstName: input.firstName };
  }
  await tx.invite.deleteMany({ where: { householdId: admin.householdId, expiresAt: { lte: now } } });
  if (await tx.invite.findFirst({ where: { householdId: admin.householdId, email: input.email }, select: { id: true } })) {
    throw new InviteError("There's already an invite waiting for that email. Cancel it first.");
  }
  if ((await tx.invite.count({ where: { householdId: admin.householdId } })) >= MAX_LIVE_INVITES) {
    throw new InviteError(TOO_MANY_INVITES);
  }
  await tx.invite.create({
    data: {
      householdId: admin.householdId,
      tokenHash: tokenHash(token),
      personId: input.who === "member" ? input.personId : null,
      firstName: input.who === "new" ? input.firstName : null,
      lastName: input.who === "new" ? input.lastName || null : null,
      email: input.email,
      role: input.role,
      createdById: admin.id,
      expiresAt: new Date(now.getTime() + hours * 3_600_000),
    },
  });
  if (!recovery) await recordSignInEvent(tx, { householdId: admin.householdId, kind: "INVITE_MADE", actor: admin, subject, detail: roleLabel(input.role) });
  return token;
}

/**
 * The link to hand over, on the address the app is served at (BETTER_AUTH_URL), which is the
 * only one its passkeys work on, whatever address the admin happens to be using.
 */
export function inviteLink(token: string): string {
  return new URL(`/invite/${token}`, process.env.BETTER_AUTH_URL || "http://localhost:3000").toString();
}

/**
 * Who can be invited from the household: grown-ups with no sign-in at all. Someone with a sign-in
 * that has no way in left is Reset's (lib/sign-ins.ts): it keeps them on that same sign-in, for an
 * hour, instead of a 48-hour invite to any address (Fable's scope review).
 */
export function invitableMembers(householdId: string) {
  return prisma.person.findMany({
    where: { householdId, isHouseholdMember: true, role: { in: ["ADULT", "ADMIN"] }, authUserId: null },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { firstName: "asc" },
  });
}

const liveWhere = (token: string, now: Date) => ({ tokenHash: tokenHash(token), expiresAt: { gt: now } });

/** What the invite page shows, without using it up: who it's for and who sent it. Null when it isn't live. */
export async function readInvite(token: string | null | undefined, now: Date = new Date()) {
  if (!token || token.length > 100) return null;
  const invite = await prisma.invite.findFirst({
    where: liveWhere(token, now),
    select: {
      id: true,
      householdId: true,
      email: true,
      firstName: true,
      person: { select: { firstName: true, authUserId: true } },
      createdBy: { select: { firstName: true } },
    },
  });
  if (!invite) return null;
  return {
    id: invite.id,
    householdId: invite.householdId,
    email: invite.email,
    firstName: invite.person?.firstName ?? invite.firstName ?? "",
    from: invite.createdBy?.firstName ?? null,
    /** A reset's recovery link: back onto the sign-in they had. */
    recovery: Boolean(invite.person?.authUserId),
  };
}

/** Removes invites past their time (the background tick, lib/background.ts). */
export async function purgeExpiredInvites(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.invite.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}

/**
 * The admin page's waiting invites, soonest to expire first, and whether each can still be used
 * (its maker is still an admin here; acceptInvite checks the same). Tokens never leave the server.
 */
export async function pendingInvites(householdId: string, now: Date = new Date()) {
  const rows = await prisma.invite.findMany({
    where: { householdId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "asc" },
    select: {
      id: true,
      firstName: true,
      email: true,
      role: true,
      expiresAt: true,
      person: { select: { firstName: true, authUserId: true } },
      createdBy: { select: { firstName: true, role: true, isHouseholdMember: true, householdId: true, entraAccessEndedAt: true } },
    },
  });
  return rows.map(({ createdBy, ...invite }) => ({
    ...invite,
    from: createdBy?.firstName ?? null,
    /** A reset's recovery link, not an invite. */
    recovery: Boolean(invite.person?.authUserId),
    usable: createdBy !== null && createdBy.role === "ADMIN" && createdBy.isHouseholdMember && createdBy.householdId === householdId && !createdBy.entraAccessEndedAt,
  }));
}

/** Cancels a waiting invite (the link stops working). */
export async function revokeInvite(admin: Admin, inviteId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findFirst({
      where: { id: inviteId, householdId: admin.householdId },
      select: { id: true, firstName: true, role: true, person: { select: { id: true, firstName: true, authUserId: true } } },
    });
    if (!invite) throw new InviteError("That invite isn't waiting anymore.");
    await tx.invite.delete({ where: { id: invite.id } });
    await recordSignInEvent(tx, {
      householdId: admin.householdId,
      kind: "INVITE_CANCELLED",
      actor: admin,
      subject: invite.person ? { id: invite.person.id, firstName: invite.person.firstName } : { id: null, firstName: invite.firstName ?? "" },
      detail: invite.person?.authUserId ? RECOVERY_DETAIL : null,
    });
  });
}

/**
 * Accepting (the passkey's afterVerification, signed out, once the passkey checked out): uses
 * the invite up and makes or reuses the user and links or creates the person, as one unit, so
 * a refusal leaves everything as it was. Returns the user the plugin puts the passkey on, and
 * the notice for whoever made the invite (40.2c) to deliver once this has committed. That
 * notice can be early: the plugin's own passkey insert comes after, and could still fail.
 */
export async function acceptInvite(token: string | null | undefined, now: Date = new Date()): Promise<{ userId: string; notices: string[] }> {
  if (!token || token.length > 100) throw new InviteError(INVITE_GONE);
  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findFirst({
      where: liveWhere(token, now),
      include: { createdBy: { select: { householdId: true, role: true, isHouseholdMember: true, entraAccessEndedAt: true } } },
    });
    if (!invite) throw new InviteError(INVITE_GONE);
    // The row lock: a second accept of the same invite waits here, then finds it gone.
    const { count } = await tx.invite.deleteMany({ where: { id: invite.id } });
    if (count !== 1) throw new InviteError(INVITE_GONE);
    const creator = invite.createdBy;
    if (!creator || creator.householdId !== invite.householdId || !creator.isHouseholdMember || creator.role !== "ADMIN" || creator.entraAccessEndedAt !== null) {
      throw new InviteError("This invite is no longer good. Ask an admin for a new one.");
    }

    // A user with this email is reused only when it's no way in: no passkey, no provider
    // account, and no person but (a sign-in that never got a passkey) this invite's.
    // A provider sign-in that never became anyone (40.3) mustn't be the passkey's: it goes first.
    await tx.user.deleteMany({
      where: { email: invite.email, ...ORPHAN, accounts: { some: { providerId: OIDC_PROVIDER_ID }, none: { providerId: { not: OIDC_PROVIDER_ID } } } },
    });
    const existing = await tx.user.findUnique({
      where: { email: invite.email },
      select: { id: true, person: { select: { id: true } }, _count: { select: { passkeys: true, accounts: true } } },
    });
    if (
      existing &&
      (existing._count.passkeys > 0 || existing._count.accounts > 0 || (existing.person !== null && existing.person.id !== invite.personId))
    ) {
      throw new InviteError("That email already belongs to a sign-in here. Ask an admin.", "CONFLICT");
    }
    const firstName = invite.firstName ?? "";
    const user = existing ?? (await tx.user.create({ data: { email: invite.email, name: firstName || invite.email }, select: { id: true } }));
    // Never an existing one with a way in, sessions included.
    if (existing) await tx.session.deleteMany({ where: { userId: user.id } });

    let person: { id: string; firstName: string };
    // A recovery link (Reset): the person already has this sign-in, with no way in left.
    let recovery = false;
    if (invite.personId) {
      const before = await tx.person.findUnique({ where: { id: invite.personId }, select: { authUserId: true } });
      recovery = before?.authUserId != null;
      const { count: linked } = await tx.person.updateMany({
        where: { id: invite.personId, householdId: invite.householdId, isHouseholdMember: true, role: { in: ["ADULT", "ADMIN"] }, ...WITHOUT_OWN_WAY_IN },
        data: { authUserId: user.id, role: invite.role },
      });
      if (linked !== 1) throw new InviteError("This invite is no longer good. Ask an admin for a new one.");
      // A sign-in left with no way in that this replaces: nothing of it may stay signed in.
      if (before?.authUserId && before.authUserId !== user.id) await tx.session.deleteMany({ where: { userId: before.authUserId } });
      person = await tx.person.findUniqueOrThrow({ where: { id: invite.personId }, select: { id: true, firstName: true } });
      await tx.user.update({ where: { id: user.id }, data: { name: person.firstName } });
    } else {
      person = await tx.person.create({
        data: { householdId: invite.householdId, firstName, lastName: invite.lastName, email: invite.email, role: invite.role, isHouseholdMember: true, authUserId: user.id },
        select: { id: true, firstName: true },
      });
    }
    await recordSignInEvent(tx, {
      householdId: invite.householdId,
      kind: "INVITE_ACCEPTED",
      actor: person,
      subject: person,
      detail: recovery ? RECOVERY_DETAIL : roleLabel(invite.role),
    });
    const notices = await writeInviteUsedNotice(tx, invite.householdId, invite.createdById, person, recovery);
    return { userId: user.id, notices };
  });
}

/**
 * Phase 40.3: before an invite goes to the OIDC provider, a sign-in left with this email and
 * nothing else (no person, no passkey, no account: a setup or invite that got no further) is
 * cleared, or Better Auth would find it by email and refuse the new account as "not linked".
 */
export async function clearLeftoverSignIn(email: string): Promise<void> {
  await prisma.user.deleteMany({ where: { email, ...ORPHAN } });
}

/** The background tick (lib/background.ts): provider sign-ins that never became anyone, after an hour. */
export async function purgeOrphanProviderSignIns(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.user.deleteMany({
    where: { ...ORPHAN, accounts: { some: { providerId: OIDC_PROVIDER_ID }, none: { providerId: { not: OIDC_PROVIDER_ID } } }, createdAt: { lt: new Date(now.getTime() - 3_600_000) } },
  });
  return count;
}

/**
 * Phase 40.3: an invite used with the OIDC provider. Better Auth has made the user (with its
 * provider account) and signed them in; this links them, once, with every check acceptInvite
 * makes, plus: the provider has confirmed the account's email, and it's the invite's, so a
 * forwarded link can't be used with someone else's account. A reset's link is passkey-only (the
 * owner's call, 2026-10-14). Refused, nothing changes (the caller clears the new sign-in).
 */
export async function acceptInviteForUser(token: string | null | undefined, userId: string, now: Date = new Date()): Promise<{ personId: string; notices: string[] }> {
  if (!token || token.length > 100) throw inviteError("gone");
  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findFirst({
      where: liveWhere(token, now),
      include: { createdBy: { select: { householdId: true, role: true, isHouseholdMember: true, entraAccessEndedAt: true } }, person: { select: { authUserId: true } } },
    });
    if (!invite) throw inviteError("gone");
    if (invite.person?.authUserId) throw inviteError("recovery");
    const { count } = await tx.invite.deleteMany({ where: { id: invite.id } });
    if (count !== 1) throw inviteError("gone");
    const creator = invite.createdBy;
    if (!creator || creator.householdId !== invite.householdId || !creator.isHouseholdMember || creator.role !== "ADMIN" || creator.entraAccessEndedAt !== null) throw inviteError("maker");

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, person: { select: { id: true } }, _count: { select: { passkeys: true } }, accounts: { select: { providerId: true } } },
    });
    if (!user || user.person || user._count.passkeys > 0 || !user.accounts.some((a) => a.providerId === OIDC_PROVIDER_ID)) throw inviteError("taken", "CONFLICT");
    // The owner's call (2026-10-14): no confirmed email from the provider, no invite through it.
    if (!user.emailVerified) throw inviteError("unverified");
    if ((user.email ?? "").toLowerCase() !== invite.email) throw inviteError("mismatch");

    let person: { id: string; firstName: string };
    if (invite.personId) {
      const { count: linked } = await tx.person.updateMany({
        where: { id: invite.personId, householdId: invite.householdId, isHouseholdMember: true, role: { in: ["ADULT", "ADMIN"] }, authUserId: null },
        data: { authUserId: userId, role: invite.role },
      });
      if (linked !== 1) throw inviteError("maker");
      person = await tx.person.findUniqueOrThrow({ where: { id: invite.personId }, select: { id: true, firstName: true } });
    } else {
      person = await tx.person.create({
        data: { householdId: invite.householdId, firstName: invite.firstName ?? "", lastName: invite.lastName, email: invite.email, role: invite.role, isHouseholdMember: true, authUserId: userId },
        select: { id: true, firstName: true },
      });
    }
    await tx.user.update({ where: { id: userId }, data: { name: person.firstName } });
    await recordSignInEvent(tx, { householdId: invite.householdId, kind: "INVITE_ACCEPTED", actor: person, subject: person, detail: roleLabel(invite.role) });
    const notices = await writeInviteUsedNotice(tx, invite.householdId, invite.createdById, person);
    return { personId: person.id, notices };
  });
}

/** A sign-in through the OIDC provider that isn't anyone yet: an invite it was meant for can still finish. */
export async function halfFinishedProviderSignIn(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { person: { select: { id: true } }, accounts: { where: { providerId: OIDC_PROVIDER_ID }, select: { id: true } } },
  });
  return Boolean(user && !user.person && user.accounts.length > 0);
}

/** A provider sign-in an invite refused: it never became anyone, so it goes (and its session with it). Only ever that. */
export async function discardOrphanSignIn(userId: string): Promise<void> {
  await prisma.user.deleteMany({
    where: { id: userId, ...ORPHAN, accounts: { some: { providerId: OIDC_PROVIDER_ID }, none: { providerId: { not: OIDC_PROVIDER_ID } } } },
  });
}
