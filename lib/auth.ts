import { accessConfigFrom } from "@/lib/security/cf-access";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { passkey } from "@better-auth/passkey";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { afterPasskeyRegistration, afterPasskeySignIn, checkSignedInRegistration, resolveSignedOutUser } from "@/lib/passkey-hooks";
import { recordPasskeyAdded } from "@/lib/my-passkeys";
import { captureError } from "@/lib/observability";
import { FRESH_SIGN_IN_SECONDS } from "@/lib/fresh-sign-in";
import { prisma } from "@/lib/prisma";
import { devAuthEnabled, devAuthPlugin } from "@/lib/dev-auth";
import { PRODUCT_NAME } from "@/lib/app-name";
import { microsoftConfigFrom } from "@/lib/microsoft-config";
import { OIDC_PROVIDER_ID, oidcConfigFrom } from "@/lib/oidc-config";
import { oidcPreflightFailed } from "@/lib/oidc-preflight";
import { checkSocialSignIn, hideKnownEmail } from "@/lib/oidc-sign-up";

export { FRESH_SIGN_IN_SECONDS };

// Phase 40.1b: Microsoft sign-in is on when all three MICROSOFT_* values are set (pinned to
// that one tenant, docs/BUILD.md Phase -1), off when none are, and a start-up error otherwise.
const microsoft = microsoftConfigFrom(process.env);

/** Whether this install signs in with Microsoft (the sign-in page, Graph features). */
export function microsoftEnabled(): boolean {
  return microsoft !== null;
}

// Phase 40.3: any OpenID Connect provider (lib/oidc-config.ts), when all four OIDC_* values are
// set and the start-up check could reach it (lib/oidc-preflight.ts; the owner's call: start
// without it otherwise).
const oidcConfig = oidcConfigFrom(process.env);
const oidc = oidcConfig && !oidcPreflightFailed() ? oidcConfig : null;

/**
 * The OIDC provider's name when people can sign in with it right now: configured, reachable at
 * start, and actually loaded (Better Auth reads its discovery document once, when it starts up,
 * with no time limit, and leaves the provider out if that fails).
 */
export async function oidcSignIn(): Promise<{ name: string } | null> {
  if (!oidc) return null;
  const ctx = await auth.$context;
  return ctx.socialProviders.some((p) => p.id === OIDC_PROVIDER_ID) ? { name: oidc.name } : null;
}

// Phase 40.1c: passkeys belong to this address (the WebAuthn "relying party"), so a passkey only
// ever works on the URL the app is served at: BETTER_AUTH_URL, set explicitly, never taken from
// a request. Changing the address later orphans every passkey made before.
const appURL = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000");

// Phase 40.1c: the reverse proxy's address (or subnet), comma-separated, so Better Auth reads the
// client's real address from X-Forwarded-For, walking past the proxy, for its rate limits. Unset,
// it only trusts an X-Forwarded-For with exactly one address in it (README "How access works").
const trustedProxies = (process.env.TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Phase 42: behind Cloudflare Access (lib/cf-access.ts, checked in proxy.ts) every request comes
// through Cloudflare, which puts the client's address in CF-Connecting-IP: one value, set by
// Cloudflare, which a client can't add to as it can to X-Forwarded-For.
const behindAccess = (() => {
  try {
    return accessConfigFrom(process.env) !== null;
  } catch {
    return false; // proxy.ts refuses every request then, and says why
  }
})();

/** Phase 42: a sign-in lasts 30 days, then the person signs in again (the owner's call). */
export const SESSION_DAYS = 30;

/** The passkey routes a caller reaches before or while signing in, each with its own limit. */
const PASSKEY_REGISTER = ["/passkey/generate-register-options", "/passkey/verify-registration"];
const PASSKEY_SIGN_IN = ["/passkey/generate-authenticate-options", "/passkey/verify-authentication"];

// DEV-ONLY testing sign-in (lib/dev-auth.ts) must never reach production.
if (process.env.NODE_ENV === "production" && process.env.DEV_AUTH) {
  throw new Error("DEV_AUTH is set in production. Remove it: the dev sign-in is for local testing only.");
}

export const auth = betterAuth({
  // What Better Auth calls the app wherever it names it (e.g. a passkey's "relying party" in
  // password managers): the product, never a family's name (AGENTS.md).
  appName: PRODUCT_NAME,
  plugins: [
    // Phase 40.1c: passkeys for grown-ups (the owner's call); kids stay on PIN profiles.
    passkey({
      rpID: appURL.hostname,
      origin: appURL.origin,
      rpName: PRODUCT_NAME,
      // A passkey the device keeps (no username to type), unlocked with the device's own PIN,
      // fingerprint or face. The plugin asks for that but doesn't check it; lib/passkey-hooks.ts
      // does, on both registration and sign-in.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      // Signed out, a registration needs a setup token or (after setup) an invite (resolveUser);
      // signed in, a ticket from Settings → My passkeys (the before hook below and
      // lib/passkey-hooks.ts).
      registration: { requireSession: false, resolveUser: resolveSignedOutUser, afterVerification: afterPasskeyRegistration },
      authentication: { afterVerification: afterPasskeySignIn },
    }),
    // Phase 40.3: one OpenID Connect provider, through Better Auth's own generic OAuth (not the
    // SSO plugin: docs/BUILD.md Phase 40). ID tokens are checked against the provider's published
    // keys, issuer, audience and a nonce; PKCE is on by default. An unknown account is refused
    // unless the sign-in asks to sign up, which only setup and an invite may (lib/oidc-sign-up.ts).
    // Signing out leaves the app only, not the provider (the owner's call, 2026-10-14). The
    // provider's picture isn't kept.
    ...(oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: OIDC_PROVIDER_ID,
                name: oidc.name,
                discoveryUrl: oidc.discoveryUrl,
                clientId: oidc.clientId,
                clientSecret: oidc.clientSecret,
                scopes: oidc.scopes,
                requireIdTokenVerification: true,
                disableImplicitSignUp: true,
                disableProviderLogout: true,
                mapProfileToUser: () => ({ image: undefined }),
              },
            ],
          }),
        ]
      : []),
    // DEV-ONLY: remove with lib/dev-auth.ts before shipping.
    ...(devAuthEnabled() ? [devAuthPlugin()] : []),
  ],
  hooks: {
    // Phase 40.2a: with a session, the plugin would let any signed-in browser (an unlocked
    // tablet, a month-old session) add a passkey to that account, so a signed-in registration
    // needs a fresh sign-in and a ticket from Settings → My passkeys (lib/passkey-hooks.ts).
    // The label a device sends is capped too.
    before: createAuthMiddleware(async (ctx) => {
      // Phase 40.3: who may sign up through a provider, and the parts of social sign-in this app
      // never uses (lib/oidc-sign-up.ts).
      if (ctx.path === "/sign-in/social") return checkSocialSignIn(ctx.body, (name) => ctx.getCookie(name));
      if (!PASSKEY_REGISTER.includes(ctx.path)) return;
      const session = await getSessionFromCtx(ctx);
      if (session) await checkSignedInRegistration(ctx, session);
      const name = (ctx.body as { name?: unknown } | undefined)?.name ?? (ctx.query as { name?: unknown } | undefined)?.name;
      if (typeof name === "string" && name.length > 40) throw new APIError("BAD_REQUEST", { message: "Keep the passkey's name to 40 characters." });
    }),
    // Phase 40.2: a passkey added while signed in goes in the sign-in audit log, once it exists
    // (the plugin returns the new passkey). A failed write is reported, not shown: the passkey
    // is made by then.
    after: createAuthMiddleware(async (ctx) => {
      // Phase 40.3: one error for "that email is someone's here" and "not invited", in the address too.
      if (ctx.path === "/callback/:id") {
        const hidden = hideKnownEmail(ctx.context.responseHeaders?.get("location"));
        if (hidden) throw ctx.redirect(hidden);
        return;
      }
      if (ctx.path !== "/passkey/verify-registration") return;
      const made = ctx.context.returned as { userId?: unknown; name?: unknown; credentialID?: unknown } | undefined;
      if (!made || made instanceof APIError || typeof made.userId !== "string" || typeof made.credentialID !== "string") return;
      if (!(await getSessionFromCtx(ctx))) return;
      await recordPasskeyAdded(made.userId, typeof made.name === "string" ? made.name : null).catch(captureError);
    }),
  },
  // Better Auth limits requests in production only, per client address (see trustedProxies and
  // behindAccess above, and README "How access works"). Phase 42: kept in the database (the
  // RateLimit table, which Better Auth prunes itself), so a restart doesn't reset them; with the
  // database down, sign-in requests fail rather than go unlimited. The passkey routes get a tighter
  // limit than its default 100 per 10 seconds.
  advanced: { ipAddress: behindAccess ? { ipAddressHeaders: ["cf-connecting-ip"] } : { trustedProxies } },
  rateLimit: {
    storage: "database",
    customRules: Object.fromEntries([...PASSKEY_REGISTER, ...PASSKEY_SIGN_IN].map((path) => [path, { window: 60, max: 10 }])),
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // This app only ever calls signIn.social, signOut, and the OAuth callback from the
  // client (grep confirms it), plus auth.api.getAccessToken/getSession server-side — those
  // server-side calls bypass HTTP routing entirely and are unaffected by disabledPaths.
  // Everything else better-auth exposes by default is surface we don't use and don't want
  // reachable, especially /get-access-token and /refresh-token: both return the signed-in
  // adult's raw (decrypted) Microsoft Graph token to any request carrying the session
  // cookie, with no PIN/active-profile check involved at all — see the security
  // remediation phase's audit. Verified against the installed better-auth route list (1.6.23,
  // and again for 1.7.7 in Phase 40.1, where the core routes are the same); re-check it on a
  // version bump. Phase 40.2a: the passkey list/rename/delete routes stay off; Settings → My
  // passkeys does those itself (lib/my-passkeys.ts), where it can refuse removing the last one
  // and ask for a fresh sign-in under a lock.
  disabledPaths: [
    "/get-access-token",
    "/refresh-token",
    "/account-info",
    "/link-social",
    "/unlink-account",
    "/list-accounts",
    "/update-user",
    "/sign-in/email",
    "/sign-up/email",
    "/change-password",
    "/set-password",
    "/request-password-reset",
    "/reset-password",
    "/send-verification-email",
    "/verify-email",
    "/change-email",
    "/delete-user",
    "/update-session",
    "/verify-password",
    "/passkey/list-user-passkeys",
    "/passkey/update-passkey",
    "/passkey/delete-passkey",
  ],
  // Phase 40.1: a failed sign-in comes back to our own sign-in page (with ?error=<code>,
  // shown as fixed words) rather than Better Auth's built-in error page.
  onAPIError: { errorURL: "/sign-in" },
  // Encrypts access/refresh tokens at rest in the `account` table, keyed by
  // BETTER_AUTH_SECRET. Was off by default — these were sitting in plaintext (Fable's
  // Phase 4.5 review). NOTE (Fable's implementation-review pass, verified against the
  // installed better-auth 1.6.23 source, and again for 1.7.7 in Phase 40.1): this flag does NOT
  // cover `idToken` — that column stays plaintext regardless. lib/active-profile.ts's
  // `decodeMicrosoftIdToken` reads it as plaintext accordingly; don't assume it's encrypted
  // without re-checking better-auth's source on a version bump.
  account: {
    encryptOAuthTokens: true,
    // Phase 40.1: a sign-in never attaches itself to an existing user just because the email
    // matches. With more than one way to sign in (passkeys, other providers), matching on email
    // would hand an account to whoever controls that address at another provider. Linking a
    // second sign-in is something a signed-in person does on purpose (Settings, 40.2). Our own
    // first-Microsoft-sign-in adoption (lib/active-profile.ts) matches a Person, not a User,
    // and is unaffected.
    //
    // Microsoft is trusted for deliberate linking only: Entra ID tokens usually carry no
    // email_verified claim, and without trust Better Auth refuses the link flow, which is how
    // the calendar grant records its extra permission (calendar/outlook/actions.ts). A link
    // always attaches to the signed-in user, from our one pinned tenant, with a matching email;
    // implicit linking stays off whatever the trust.
    accountLinking: { disableImplicitLinking: true, trustedProviders: ["microsoft"] },
  },
  // Phase 28: a session is "fresh" for 15 minutes after its sign-in; backups and restores
  // ask for that (lib/session.ts signedInRecently, lib/fresh-sign-in.ts). Every sign-in makes a new
  // session row, and a refresh only moves expiresAt/updatedAt, so createdAt is the sign-in
  // time. Better Auth's own sensitive endpoints use the same number.
  session: {
    freshAge: FRESH_SIGN_IN_SECONDS,
    // Phase 42: 30 days from signing in, not sliding while it's used, so a stolen session can't
    // last forever; it matches Cloudflare Access's monthly session.
    expiresIn: SESSION_DAYS * 24 * 60 * 60,
    disableSessionRefresh: true,
  },
  socialProviders: microsoft
    ? {
        microsoft: {
          clientId: microsoft.clientId,
          clientSecret: microsoft.clientSecret,
          // Pinned to our own tenant (not "common") so only accounts in the
          // family M365 tenant can ever complete sign-in.
          tenantId: microsoft.tenantId,
          prompt: "select_account",
          // The app never uses client-supplied-idToken sign-in; the Microsoft provider does
          // verify signature/audience/tenant/max-age on that path so it can't forge a role
          // claim, but there's no reason to leave it reachable when it's unused.
          disableIdTokenSignIn: true,
          // Explicit and complete rather than additive — Better Auth's docs don't clearly
          // state whether a custom `scope` merges with or replaces its Microsoft defaults, so
          // list everything we need (auth basics + Graph) rather than risk silently losing
          // User.Read/offline_access if it turns out to replace.
          scope: [
            "openid",
            "profile",
            "email",
            "User.Read",
            "offline_access",
            "Calendars.Read",
            "Calendars.Read.Shared",
            "Mail.Read",
            "Mail.Read.Shared",
          ],
          mapProfileToUser: (profile) => ({
            name: profile.name,
            // Microsoft returns profile pictures as base64, which overflows
            // response header size limits — discard rather than store it.
            image: undefined,
          }),
        },
      }
    : {},
});
