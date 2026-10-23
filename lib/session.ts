import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isFreshSession } from "@/lib/fresh-sign-in";

/**
 * Once per request: the layout, the page and every requireActiveProfile/isOwnSignIn call
 * ask for the session, and each uncached call is a session + user query (Sentry flagged the
 * repeats as an N+1 on Home). React's cache is scoped to one request, so a sign-in or
 * sign-out is seen on the next one.
 */
export const getServerSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/**
 * Phase 28 step-up: true when this session's sign-in happened in the last
 * FRESH_SIGN_IN_SECONDS. Better Auth's Microsoft sign-in can't force a password prompt per
 * call (its `prompt` is fixed), so "fresh" means a new sign-in through Entra, where the
 * family tenant's Conditional Access (MFA, sign-in frequency) applies.
 */
export async function signedInRecently(now: number = Date.now()): Promise<boolean> {
  const session = await getServerSession();
  if (!session) return false;
  return isFreshSession(session.session.createdAt, now);
}

/** Phase 40.2: the same, for a shorter window (a new way in: NEW_WAY_IN_SECONDS). */
export async function signedInWithin(seconds: number, now: number = Date.now()): Promise<boolean> {
  const session = await getServerSession();
  if (!session) return false;
  return isFreshSession(session.session.createdAt, now, seconds);
}
