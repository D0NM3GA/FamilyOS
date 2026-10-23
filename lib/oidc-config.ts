/**
 * Phase 40.3: sign in with any OpenID Connect provider (Google, Authentik, Keycloak, Pocket ID…),
 * through Better Auth's generic OAuth (lib/auth.ts). Optional, like Microsoft: all four OIDC_*
 * settings, or none. Some but not all is a mistake worth stopping on at start. Pure (reads only
 * what it's given), so lib/auth.ts, instrumentation.ts and the tests share it.
 *
 * One provider: a family has one identity provider. Its id is fixed, so the redirect address to
 * register with the provider is always `<BETTER_AUTH_URL>/api/auth/callback/oidc`. Switching to a
 * different provider later means everyone on it signs up again (their ids there are new).
 */
export const OIDC_PROVIDER_ID = "oidc";

export type OidcConfig = {
  name: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
};

const KEYS = ["OIDC_DISCOVERY_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_NAME"] as const;
const DEFAULT_SCOPES = ["openid", "email", "profile"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function oidcConfigFrom(env: Record<string, string | undefined>): OidcConfig | null {
  const values = KEYS.map((k) => env[k]?.trim() || "");
  const set = values.filter(Boolean).length;
  if (set === 0) return null;
  if (set < KEYS.length) {
    const missing = KEYS.filter((_, i) => !values[i]).join(", ");
    throw new Error(`OIDC sign-in is half set up: ${missing} missing. Set all four OIDC_* values, or none to sign in without it.`);
  }
  const [discoveryUrl, clientId, clientSecret, name] = values;

  let url: URL;
  try {
    url = new URL(discoveryUrl);
  } catch {
    throw new Error("OIDC_DISCOVERY_URL isn't a web address. Use the provider's .well-known/openid-configuration address.");
  }
  // HTTPS, always; plain http only to this machine while developing (a test provider).
  const loopbackDev = url.protocol === "http:" && LOOPBACK.has(url.hostname) && env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !loopbackDev) throw new Error("OIDC_DISCOVERY_URL must start with https://.");
  if (url.username || url.password) throw new Error("OIDC_DISCOVERY_URL can't carry a user name or password.");

  // The button says "Sign in with <name>": short, printable, no markup.
  if (name.length > 30 || !/^[\p{L}\p{N} .'&()-]+$/u.test(name)) {
    throw new Error("OIDC_NAME should be the provider's name as people know it (letters, numbers, spaces; up to 30).");
  }

  const scopes = (env.OIDC_SCOPES?.trim() || DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  for (const needed of ["openid", "email"]) {
    if (!scopes.includes(needed)) throw new Error(`OIDC_SCOPES must include "${needed}" (the app needs the provider's verified email).`);
  }
  return { name, discoveryUrl: url.toString(), clientId, clientSecret, scopes };
}
