import { randomUUID } from "node:crypto";
import { APIError, getSessionFromCtx } from "better-auth/api";
import type { PasskeyOptions } from "@better-auth/passkey";
import { prisma } from "@/lib/prisma";
import { NEW_WAY_IN_SECONDS, isFreshSession } from "@/lib/fresh-sign-in";
import { addPasskeyTicketIsLive, spendAddPasskeyTicket, type SessionFacts } from "@/lib/my-passkeys";
import { consumeSetupToken, isSetUp, readSetupToken, saveFinishDetails } from "@/lib/setup";
import { acceptInvite, INVITE_GONE, InviteError, readInvite } from "@/lib/invites";
import { deliverSignInNotices } from "@/lib/sign-in-notices";

/**
 * The passkey plugin's hooks (lib/auth.ts). A passkey is registered in one of three ways:
 *
 * - Signed out, before setup: setup's first passkey (Phase 40.1c, lib/setup.ts), with a setup
 *   token.
 * - Signed out, after setup (Phase 40.2b): someone accepting an admin's invite (lib/invites.ts),
 *   with the invite's token. Their sign-in is made, and their person linked, only once the
 *   passkey checks out.
 * - Signed in (Phase 40.2a): another passkey for yourself, with a ticket from Settings → My
 *   passkeys (lib/my-passkeys.ts) bound to this session, within 5 minutes of signing in. The
 *   plugin then registers it for the session's user and never asks resolveUser, so a token
 *   meant for a signed-out registration is never looked at, let alone used up. The ticket is
 *   checked on the way in (the `context` query) and spent on the way out from the copy the
 *   plugin stored with the challenge, so swapping `context` between the two steps changes
 *   nothing.
 *
 * Both ceremonies must have used the device's own lock (user verification): the plugin asks
 * for it but doesn't check, so these do.
 */

type RegistrationArgs = Parameters<NonNullable<NonNullable<PasskeyOptions["registration"]>["afterVerification"]>>[0];
type AuthenticationArgs = Parameters<NonNullable<NonNullable<PasskeyOptions["authentication"]>["afterVerification"]>>[0];
type HookContext = RegistrationArgs["ctx"];

const EXPIRED = "This setup has expired. Start again from the setup page.";
const NEEDS_UNLOCK = "Use your device's PIN, fingerprint or face for the passkey.";
const START_FROM_SETTINGS = "Add a passkey from Settings → My passkeys.";

const sessionFacts = (s: { session: { id: string; userId: string; createdAt: Date | string } }): SessionFacts => ({
  id: s.session.id,
  userId: s.session.userId,
  createdAt: s.session.createdAt,
});

/**
 * lib/auth.ts's `before` hook for the two registration routes, when the request is signed in:
 * a sign-in from the last 5 minutes, a live ticket for this session (checked again, and used
 * up, in afterPasskeyRegistration), and no second session (a new, fresh session per passkey
 * would keep a sign-in fresh for ever).
 */
export async function checkSignedInRegistration(ctx: HookContext, session: Parameters<typeof sessionFacts>[0]): Promise<void> {
  const facts = sessionFacts(session);
  if (!isFreshSession(facts.createdAt, Date.now(), NEW_WAY_IN_SECONDS)) throw new APIError("FORBIDDEN", { message: "Sign in again first, then add the passkey." });
  if (ctx.path === "/passkey/generate-register-options") {
    const context = (ctx.query as { context?: unknown } | undefined)?.context;
    if (typeof context !== "string" || !(await addPasskeyTicketIsLive(context, facts))) {
      throw new APIError("FORBIDDEN", { message: START_FROM_SETTINGS });
    }
  } else if ((ctx.body as { createSession?: unknown } | undefined)?.createSession) {
    throw new APIError("BAD_REQUEST", { message: "You're already signed in." });
  }
}

/**
 * The passkey's `registration.resolveUser` (signed out only): before setup, a live setup token;
 * after it, a live invite. Either way a throwaway id for the ceremony: the real user is made
 * only once the passkey checks out, and is never an existing one with a way in.
 */
export async function resolveSignedOutUser({ context }: { context?: string | null }) {
  if (!(await isSetUp())) {
    const details = await readSetupToken(context);
    if (!details) throw new APIError("FORBIDDEN", { message: EXPIRED });
    return { id: `setup-${randomUUID()}`, name: details.email, displayName: details.firstName };
  }
  const invite = await readInvite(context);
  if (!invite) throw new APIError("FORBIDDEN", { message: INVITE_GONE });
  return { id: `invite-${randomUUID()}`, name: invite.email, displayName: invite.firstName };
}

/**
 * The passkey's `registration.afterVerification`: the device's lock, then the right token for the
 * way in. Signed in, it names the passkey from the ticket (the plugin keeps the session's user).
 */
export async function afterPasskeyRegistration(args: RegistrationArgs): Promise<{ userId?: string; name?: string }> {
  if (!args.verification.registrationInfo?.userVerified) throw new APIError("BAD_REQUEST", { message: NEEDS_UNLOCK });
  const session = await getSessionFromCtx(args.ctx);
  if (!session) return (await isSetUp()) ? afterInviteRegistration(args) : afterSetupRegistration(args);
  // The plugin has already refused a registration started for anyone else; this is belt and braces.
  const ticket = args.user.id === session.user.id ? await spendAddPasskeyTicket(args.context, sessionFacts(session)) : null;
  if (!ticket) throw new APIError("FORBIDDEN", { message: START_FROM_SETTINGS });
  return ticket.name ? { name: ticket.name } : {};
}

/**
 * Setup's first passkey: uses the setup token up (once), makes the new user and keeps step 2's
 * details. A user left by an earlier attempt that got no further (no passkey, no sign-in, no
 * person) is reused rather than refusing its email forever. That case is real, not
 * theoretical: the Prisma adapter runs without transactions (lib/auth.ts), so the plugin's
 * user, passkey and session writes aren't one unit, and a failed passkey insert leaves the user
 * behind.
 */
async function afterSetupRegistration({ ctx, context }: RegistrationArgs): Promise<{ userId: string }> {
  const details = await consumeSetupToken(context);
  if (!details || (await isSetUp())) throw new APIError("FORBIDDEN", { message: EXPIRED });

  const existing = await prisma.user.findUnique({
    where: { email: details.email },
    select: { id: true, person: { select: { id: true } }, _count: { select: { passkeys: true, accounts: true } } },
  });
  let userId: string;
  if (existing) {
    if (existing.person || existing._count.passkeys > 0 || existing._count.accounts > 0) {
      throw new APIError("CONFLICT", { message: "That email already belongs to a sign-in here." });
    }
    userId = existing.id;
    await prisma.user.update({ where: { id: userId }, data: { name: details.firstName } });
  } else {
    const user = await ctx.context.internalAdapter.createUser(
      { email: details.email, name: details.firstName, emailVerified: false },
      { method: "passkey-setup" },
    );
    userId = user.id;
  }
  await saveFinishDetails(userId, { householdName: details.householdName, firstName: details.firstName });
  return { userId };
}

/** An invite's passkey: uses the invite up and makes the sign-in, all or nothing (lib/invites.ts). */
async function afterInviteRegistration({ context }: RegistrationArgs): Promise<{ userId: string }> {
  try {
    const { userId, notices } = await acceptInvite(context);
    // Committed: tell whoever made the invite, without holding up the sign-in.
    if (notices.length) void deliverSignInNotices({ otherNotices: notices });
    return { userId };
  } catch (e) {
    if (e instanceof InviteError) throw new APIError(e.status, { message: e.message });
    throw e;
  }
}

/** The passkey's `authentication.afterVerification`: the device's own lock was used. */
export async function afterPasskeySignIn({ verification }: AuthenticationArgs): Promise<void> {
  if (!verification.authenticationInfo.userVerified) throw new APIError("UNAUTHORIZED", { message: NEEDS_UNLOCK });
}
