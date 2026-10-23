import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { NEW_WAY_IN_SECONDS, isFreshSession } from "@/lib/fresh-sign-in";
import { consumeToken, findToken, storeToken } from "@/lib/one-time-tokens";
import { recordSignInEvent } from "@/lib/sign-in-events";
import { deliverSignInNotices, writeSignInNotices } from "@/lib/sign-in-notices";

/**
 * Phase 40.2a: people who sign in with a passkey look after their own passkeys (Settings → My
 * passkeys): add another (a second device, a spare), rename one, remove one. People with a
 * Microsoft (or, later, another provider's) sign-in use that alone, the owner's call, so
 * Entra's rules (Conditional Access, turning an account off) always apply to them.
 *
 * Adding a passkey while signed in takes a ticket. The app's own checks issue it (this is the
 * signed-in person's own profile, they signed in within the last 5 minutes, they're a passkey
 * person), and the passkey plugin accepts a registration with a session only with a live
 * ticket bound to that session (lib/auth.ts, lib/passkey-hooks.ts). Without one, any browser
 * left signed in (an unlocked tablet, a kid on a parent's sign-in) could add a passkey to that
 * account. The ticket also carries the passkey's name, so the device's own prompt shows the
 * person's email as the account, not "Work laptop".
 */

const TICKET = "add-passkey";
const TICKET_MINUTES = 5;

export const passkeyNameSchema = z.string().trim().min(1, "Give it a name.").max(40, "Keep the name to 40 characters.");

/** Every refusal, as fixed words: the page shows them by code, never text from a URL. */
export const PASSKEY_ERRORS = {
  stale: "Sign in again first.",
  notPasskeyPerson: "Passkeys here are for grown-ups who sign in with one.",
  notOwn: "Switch to your own profile first.",
  gone: "That passkey isn't here anymore.",
  last: "It's your only passkey. Add another one first.",
} as const;
export type PasskeyErrorCode = keyof typeof PASSKEY_ERRORS;

export class PasskeyError extends Error {
  constructor(readonly code: PasskeyErrorCode) {
    super(PASSKEY_ERRORS[code]);
  }
}

/** The parts of a Better Auth session these checks need. */
export type SessionFacts = { id: string; userId: string; createdAt: Date | string };

/**
 * The person behind a sign-in who may look after their own passkeys: a grown-up in the
 * household whose sign-in has no provider account (Microsoft or another). Null otherwise.
 */
export async function passkeyPerson(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      _count: { select: { accounts: true } },
      person: { select: { id: true, firstName: true, householdId: true, role: true, isHouseholdMember: true } },
    },
  });
  const person = user?.person;
  if (!person || !person.isHouseholdMember || person.role === "KID" || user._count.accounts > 0) return null;
  return person;
}

/** Someone's passkeys, oldest first. Public keys and counters stay on the server. */
export function listPasskeys(userId: string) {
  return prisma.passkey.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, deviceType: true, backedUp: true },
  });
}

const ticketSchema = z.object({ sessionId: z.string(), userId: z.string(), name: z.string().optional() });
type Ticket = z.infer<typeof ticketSchema>;

// The session part comes first, so every ticket of one session starts with the same text.
const sessionPart = (session: SessionFacts) => JSON.stringify({ sessionId: session.id, userId: session.userId }).slice(0, -1);

/** The ticket's contents, when it's this session's. */
function ticketFor(value: string, session: SessionFacts): Ticket | null {
  try {
    const parsed = ticketSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.sessionId === session.id && parsed.data.userId === session.userId ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A ticket to add one passkey (named `name`, if given) in the next few minutes, for this session only. */
export async function createAddPasskeyTicket(session: SessionFacts, name?: string, now: number = Date.now()): Promise<string> {
  if (!isFreshSession(session.createdAt, now, NEW_WAY_IN_SECONDS)) throw new PasskeyError("stale");
  if (!(await passkeyPerson(session.userId))) throw new PasskeyError("notPasskeyPerson");
  const ticket: Ticket = { sessionId: session.id, userId: session.userId, ...(name ? { name } : {}) };
  // One live ticket per session: a new one replaces the last, under a lock so two at once can't both stay.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TICKET + ":" + session.id}))`;
    await tx.verification.deleteMany({ where: { identifier: { startsWith: `${TICKET}:` }, value: { startsWith: sessionPart(session) } } });
    return storeToken(TICKET, JSON.stringify(ticket), new Date(now + TICKET_MINUTES * 60_000), tx);
  });
}

/** Whether `token` is a live ticket for this session (registration's first step; not used up). */
export async function addPasskeyTicketIsLive(token: string | null | undefined, session: SessionFacts): Promise<boolean> {
  const row = await findToken(TICKET, token);
  return row !== null && ticketFor(row.value, session) !== null;
}

/** Uses the ticket up, once, if it's this session's (registration's last step); returns what it holds. */
export async function spendAddPasskeyTicket(token: string | null | undefined, session: SessionFacts): Promise<Ticket | null> {
  const value = await consumeToken(TICKET, token, (v) => ticketFor(v, session) !== null);
  return value === null ? null : ticketFor(value, session);
}

/**
 * A passkey just made while signed in goes in the audit log, and the person is told (40.2c,
 * always: "if that wasn't you") — lib/auth.ts's after hook. Delivery runs on after the request,
 * not through next/server's after(): this also runs outside a Next request (the tests).
 */
export async function recordPasskeyAdded(userId: string, name: string | null | undefined): Promise<void> {
  const person = await prisma.person.findUnique({ where: { authUserId: userId }, select: { id: true, firstName: true, householdId: true } });
  if (!person) return;
  const notices = await prisma.$transaction(async (tx) => {
    await recordSignInEvent(tx, { householdId: person.householdId, kind: "PASSKEY_ADDED", actor: person, subject: person, detail: name });
    return writeSignInNotices(tx, { householdId: person.householdId, kind: "PASSKEY_ADDED", actor: person, subject: person });
  });
  void deliverSignInNotices(notices);
}

export async function renamePasskey(userId: string, passkeyId: string, name: string): Promise<void> {
  const { count } = await prisma.passkey.updateMany({ where: { id: passkeyId, userId }, data: { name } });
  if (count === 0) throw new PasskeyError("gone");
}

/**
 * Removes one of your passkeys, never the last (it's your only way in), and signs you out
 * everywhere else: a lost phone is usually still signed in. The lock makes two removals at
 * once take turns, so they can't both see "two left" and leave none.
 */
export async function removePasskey(session: SessionFacts, passkeyId: string, now: number = Date.now()): Promise<void> {
  if (!isFreshSession(session.createdAt, now)) throw new PasskeyError("stale");
  const person = await passkeyPerson(session.userId);
  if (!person) throw new PasskeyError("notPasskeyPerson");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"passkeys:" + session.userId}))`;
    const passkeys = await tx.passkey.findMany({ where: { userId: session.userId }, select: { id: true, name: true } });
    const target = passkeys.find((p) => p.id === passkeyId);
    if (!target) throw new PasskeyError("gone");
    if (passkeys.length < 2) throw new PasskeyError("last");
    await tx.passkey.delete({ where: { id: target.id } });
    await tx.session.deleteMany({ where: { userId: session.userId, id: { not: session.id } } });
    await recordSignInEvent(tx, { householdId: person.householdId, kind: "PASSKEY_REMOVED", actor: person, subject: person, detail: target.name });
  });
}
