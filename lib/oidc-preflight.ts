import type { OidcConfig } from "@/lib/oidc-config";

/**
 * Phase 40.3: before Better Auth reads the provider's discovery document (it does that once, at
 * its first use, with no time limit, and quietly leaves the provider out if it fails), the
 * server checks it itself at start (instrumentation.ts), with a time limit. If the provider
 * can't be reached, the app starts without it (the owner's call, 2026-10-14): passkeys and
 * Microsoft keep working, the sign-in page says so, and a restart tries again.
 *
 * The result lives on globalThis because instrumentation and the app's routes are bundled
 * separately and don't share module state; it's one process.
 */

const KEY = Symbol.for("familyos.oidcPreflight");
type Store = { [KEY]?: { ok: boolean } };

export function recordOidcPreflight(ok: boolean): void {
  (globalThis as Store)[KEY] = { ok };
}

/** True only when the start-up check ran and failed (tests and scripts don't run it). */
export function oidcPreflightFailed(): boolean {
  return (globalThis as Store)[KEY]?.ok === false;
}

const PRIVATE_DEV = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameRules(endpoint: unknown, production: boolean): boolean {
  if (typeof endpoint !== "string") return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || (!production && url.protocol === "http:" && PRIVATE_DEV.has(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Fetches and checks the discovery document: the endpoints the sign-in needs, over https, and
 * the keys its ID tokens are checked against. Returns a fixed-text reason when it won't do.
 */
export async function checkOidcDiscovery(
  config: Pick<OidcConfig, "discoveryUrl">,
  { fetchFn = fetch, timeoutMs = 5_000, production = process.env.NODE_ENV === "production" } = {},
): Promise<string | null> {
  let doc: Record<string, unknown>;
  try {
    const res = await fetchFn(config.discoveryUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return `the provider answered ${res.status}`;
    doc = (await res.json()) as Record<string, unknown>;
  } catch {
    return "the provider couldn't be reached";
  }
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (!sameRules(doc[key], production)) return `its settings have no usable ${key}`;
  }
  // Optional, but when there is one it gets the access token, so the same rules.
  if (doc.userinfo_endpoint !== undefined && !sameRules(doc.userinfo_endpoint, production)) return "its settings have no usable userinfo_endpoint";
  const algs = doc.id_token_signing_alg_values_supported;
  if (!Array.isArray(algs) || algs.length === 0) return "it doesn't say how its ID tokens are signed";
  return null;
}
