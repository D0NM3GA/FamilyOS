import { createHmac, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";
import { isSetUp } from "@/lib/setup";
import { readInvite } from "@/lib/invites";

/**
 * Phase 40.3: who may make a new sign-in through the OIDC provider. The provider refuses unknown
 * accounts (`disableImplicitSignUp`) unless the sign-in asks to sign up, and asking is the
 * browser's to do, so lib/auth.ts's `before` hook on /sign-in/social checks it here: only while
 * the install isn't set up yet (the first visitor, as with passkeys and Microsoft), or with a
 * live invite the browser just opened (the `invite_start` cookie, set by the invite page and
 * signed so it can't be made up). Without this, anyone with an account at a public provider
 * could fill the database with sign-ins. Microsoft never needs to ask, so it never may.
 *
 * Also refused, for every provider: signing in with an ID token sent by the browser (it skips
 * PKCE and the server's own nonce; this app never uses it), and extra scopes.
 *
 * The hook sees the request's raw JSON, before Better Auth checks its shape, so these checks
 * fail closed on purpose (`!== undefined`, truthiness): don't tidy them into `=== true`.
 */

export const INVITE_START_COOKIE = "invite_start";
export const INVITE_START_SECONDS = 15 * 60;

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set; the invite cookie can't be signed.");
  return createHmac("sha256", secret).update("familyos-invite-start-v1").digest();
}

const sign = (token: string) => createHmac("sha256", key()).update(token).digest("base64url");

/** The cookie's value: the invite's token and its signature. httpOnly, for /api/auth only. */
export function inviteStartValue(token: string): string {
  return `${token}.${sign(token)}`;
}

/** The invite token in a cookie value, if the signature checks out. */
export function tokenFromInviteStart(value: string | null | undefined): string | null {
  if (!value || value.length > 200) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(token));
  return given.length === expected.length && timingSafeEqual(given, expected) ? token : null;
}

const refuse = (message: string) => new APIError("FORBIDDEN", { message });

type SocialBody = { provider?: unknown; requestSignUp?: unknown; idToken?: unknown; scopes?: unknown };

/** lib/auth.ts's `before` hook for /sign-in/social. */
export async function checkSocialSignIn(body: unknown, cookie: (name: string) => string | null | undefined): Promise<void> {
  const b = (body ?? {}) as SocialBody;
  if (b.idToken !== undefined) throw refuse("This way of signing in isn't available.");
  if (b.scopes !== undefined) throw refuse("This way of signing in isn't available.");
  if (!b.requestSignUp) return;
  if (b.provider !== OIDC_PROVIDER_ID) throw refuse("This way of signing in isn't available.");
  if (!(await isSetUp())) return;
  const token = tokenFromInviteStart(cookie(INVITE_START_COOKIE));
  const invite = token ? await readInvite(token) : null;
  // A reset's link makes a new passkey only (the owner's call, 2026-10-14).
  if (!invite || invite.recovery) throw refuse("Open your invite link again to sign up.");
}

/**
 * Better Auth's provider callback says "not linked" when the account's email is already someone's
 * here and "sign-up disabled" when it isn't: in the address it redirects to. Both become the
 * second (lib/auth.ts's `after` hook), so a provider account can't be used to learn whether an
 * email is known. Returns the new address, or null when there's nothing to change.
 */
export function hideKnownEmail(location: string | null | undefined): string | null {
  if (!location) return null;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(location);
  let url: URL;
  try {
    url = new URL(location, "http://relative.invalid");
  } catch {
    return null;
  }
  if (url.searchParams.get("error") !== "account_not_linked") return null;
  url.searchParams.set("error", "signup_disabled");
  url.searchParams.delete("error_description");
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
