import type { PersonRole } from "@/app/generated/prisma/enums";

/** The audit log's and notices' actor when Entra made the change (Phase 40.4): no person behind it. */
export const ENTRA = { id: null, firstName: "Entra" } as const;

/**
 * Reading a stored Microsoft ID token's claims (`account.idToken`, plaintext: Better Auth
 * encrypts access and refresh tokens only). Pure, so lib/active-profile.ts and the Entra check
 * (lib/entra-check.ts, Phase 40.4) share it. No signature check here: the token came
 * server-to-server from Entra's token endpoint over TLS (authenticated with our client secret)
 * when Better Auth stored it at sign-in or refresh; this only reads what it said.
 *
 * Plaintext, not encrypted: `account.encryptOAuthTokens` (lib/auth.ts) covers only the access and
 * refresh tokens in Better Auth 1.7.7 (`oauth2/link-account.mjs` writes `idToken` as is in every
 * path). Re-check that source before assuming otherwise on a version bump.
 */
export function decodeIdTokenClaims(idToken: string): { roles?: unknown; iat?: unknown } | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as { roles?: unknown; iat?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * Maps the Entra ID token's `roles` app-role claim (exact `value` strings configured in
 * Entra — see docs/BUILD.md Phase 4.5) to our PersonRole. Deliberately returns null — not
 * "ADULT" — when the claim is absent, empty, or contains only "Kid": that role exists in
 * Entra (kids have real M365 accounts, per the owner) but is intentionally unconsumed here.
 */
export function mapEntraRoleClaim(roles: unknown): Extract<PersonRole, "ADMIN" | "ADULT"> | null {
  if (!Array.isArray(roles)) return null;
  if (roles.includes("Admin")) return "ADMIN";
  if (roles.includes("Adult")) return "ADULT";
  return null;
}
