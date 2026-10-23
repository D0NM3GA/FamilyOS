import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Phase 42: only requests that came through Cloudflare Access reach the app (proxy.ts). Access
 * signs a token for every request it lets through and sends it as `Cf-Access-Jwt-Assertion` (the
 * header, not the `CF_Authorization` cookie, which Cloudflare doesn't guarantee). This checks it
 * with Node's own crypto: RS256 with the team's keys, the application's audience tag, the team as
 * issuer, and the time, with a minute's leeway. On when CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD
 * are both set; it fails closed (the owner's call): no valid token, no entry (42.7's break-glass
 * entrance is the way in during an outage).
 */
export type AccessConfig = { issuer: string; aud: string; certsUrl: string };

export function accessConfigFrom(env: Record<string, string | undefined>): AccessConfig | null {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!team || !aud) return null;
  // The team's own subdomain of cloudflareaccess.com, never anywhere else to fetch keys from.
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(team)) throw new Error("CF_ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com.");
  return { issuer: `https://${team}`, aud, certsUrl: `https://${team}/cdn-cgi/access/certs` };
}

const LEEWAY_S = 60;
/** After a successful fetch, an unknown key id refetches at most once a minute (random key ids can't make the app hammer Cloudflare). */
const REFETCH_MS = 60_000;
/** After a failed fetch, try again sooner: Cloudflare may only have blinked. */
const RETRY_MS = 5_000;

type KeyCache = { keys: Map<string, KeyObject>; nextFetchAt: number; inFlight: Promise<void> | null };
const caches = new Map<string, KeyCache>();

async function fetchKeys(cfg: AccessConfig, cache: KeyCache, now: number, fetchFn: typeof fetch): Promise<void> {
  try {
    const res = await fetchFn(cfg.certsUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; kty?: string })[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        // A key that isn't usable is skipped.
      }
    }
    cache.keys = keys;
    cache.nextFetchAt = now + REFETCH_MS;
  } catch {
    cache.nextFetchAt = now + RETRY_MS;
  }
}

async function keyFor(cfg: AccessConfig, kid: string, now: number, fetchFn: typeof fetch): Promise<KeyObject | null> {
  let cache = caches.get(cfg.certsUrl);
  if (!cache) {
    cache = { keys: new Map(), nextFetchAt: 0, inFlight: null };
    caches.set(cfg.certsUrl, cache);
  }
  if (cache.keys.has(kid)) return cache.keys.get(kid)!;
  // Requests arriving while the keys are being fetched wait for that one fetch.
  if (!cache.inFlight && now >= cache.nextFetchAt) {
    const c = cache;
    c.inFlight = fetchKeys(cfg, c, now, fetchFn).finally(() => {
      c.inFlight = null;
    });
  }
  if (cache.inFlight) await cache.inFlight;
  return cache.keys.get(kid) ?? null;
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

/** Why a request was refused (logged by proxy.ts, so a misconfigured audience doesn't fail silently). */
export type AccessRefusal = "no token" | "malformed" | "unknown key" | "bad signature" | "wrong audience" | "wrong issuer" | "expired" | "not yet valid";

export async function checkAccessToken(
  token: string | null | undefined,
  cfg: AccessConfig,
  { now = Date.now(), fetchFn = fetch }: { now?: number; fetchFn?: typeof fetch } = {},
): Promise<{ ok: true } | { ok: false; reason: AccessRefusal }> {
  if (!token) return { ok: false, reason: "no token" };
  if (token.length > 8192) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decode(parts[0]);
    claims = decode(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "malformed" };
  const key = await keyFor(cfg, header.kid, now, fetchFn);
  if (!key) return { ok: false, reason: "unknown key" };
  if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) return { ok: false, reason: "bad signature" };

  const nowS = now / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) return { ok: false, reason: "wrong audience" };
  if (claims.iss !== cfg.issuer) return { ok: false, reason: "wrong issuer" };
  if (typeof claims.exp !== "number" || claims.exp < nowS - LEEWAY_S) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > nowS + LEEWAY_S) return { ok: false, reason: "not yet valid" };
  return { ok: true };
}

export async function verifyAccessToken(
  token: string | null | undefined,
  cfg: AccessConfig,
  opts: { now?: number; fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  return (await checkAccessToken(token, cfg, opts)).ok;
}

/** Test support: forget cached keys. */
export function resetAccessKeyCache(): void {
  caches.clear();
}
