/**
 * The newest of Better Auth's secrets, for the app's own signed cookies (the active profile, an
 * invite's start). Phase 67c: while Better Auth's secret is being rotated (BETTER_AUTH_SECRETS,
 * newest first, with BETTER_AUTH_SECRET left at the old value for tokens stored before), the
 * newest one keys them, so a leaked old secret doesn't. Its own module, with no imports, so
 * lib/oidc-sign-up.ts (loaded by lib/auth.ts) can use it without a cycle.
 */
export function currentAuthSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  const first = env.BETTER_AUTH_SECRETS?.split(",")[0]?.trim();
  const colon = first ? first.indexOf(":") : -1;
  const newest = first && colon > 0 ? first.slice(colon + 1).trim() : "";
  return newest || env.BETTER_AUTH_SECRET;
}
