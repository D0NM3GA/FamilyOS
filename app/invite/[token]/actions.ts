"use server";

import { cookies } from "next/headers";
import { getServerSession } from "@/lib/session";
import { oidcSignIn } from "@/lib/auth";
import { clearLeftoverSignIn, INVITE_ERRORS, readInvite } from "@/lib/invites";
import { INVITE_START_COOKIE, INVITE_START_SECONDS, inviteStartValue } from "@/lib/oidc-sign-up";

export type ProviderStart = { ok?: true; error?: string };

/**
 * Phase 40.3: the first half of "Use <provider> instead" on an invite. Checks the invite, clears
 * a sign-in left with its email and nothing else, and hands the browser a signed cookie for
 * /api/auth that lets this one sign-in ask to sign up (lib/oidc-sign-up.ts). The browser then
 * goes to the provider and comes back to /invite/<token>/finish.
 */
export async function startProviderInvite(token: string): Promise<ProviderStart> {
  if (typeof token !== "string" || token.length > 100) return { error: INVITE_ERRORS.gone };
  if (await getServerSession()) return { error: "Sign out first." };
  if (!(await oidcSignIn())) return { error: INVITE_ERRORS.provider };
  const invite = await readInvite(token);
  if (!invite) return { error: INVITE_ERRORS.gone };
  if (invite.recovery) return { error: INVITE_ERRORS.recovery };
  await clearLeftoverSignIn(invite.email);
  (await cookies()).set(INVITE_START_COOKIE, inviteStartValue(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: INVITE_START_SECONDS,
  });
  return { ok: true };
}
