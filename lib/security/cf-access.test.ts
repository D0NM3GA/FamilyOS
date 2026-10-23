import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { accessConfigFrom, checkAccessToken, resetAccessKeyCache, verifyAccessToken } from "./cf-access";

/** Phase 42: Cloudflare Access's token, checked with a key made here (no network). */
const cfg = accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: "parkers.cloudflareaccess.com", CF_ACCESS_AUD: "aud-tag-123" })!;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = Date.UTC(2026, 9, 22, 12);
const nowS = NOW / 1000;

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: object, { kid = "k1", key = privateKey, alg = "RS256" } = {}) {
  const head = `${b64({ alg, kid, typ: "JWT" })}.${b64(claims)}`;
  return `${head}.${sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
}
const good = { aud: ["aud-tag-123"], iss: "https://parkers.cloudflareaccess.com", iat: nowS - 10, nbf: nowS - 10, exp: nowS + 600, email: "dad@example.com" };

const certs = () =>
  vi.fn(async () => Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] })) as unknown as typeof fetch;

beforeEach(() => resetAccessKeyCache());

describe("Cloudflare Access settings", () => {
  test("both or nothing, and only a cloudflareaccess.com team", () => {
    expect(accessConfigFrom({})).toBeNull();
    expect(accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: "parkers.cloudflareaccess.com" })).toBeNull();
    expect(cfg).toEqual({ issuer: "https://parkers.cloudflareaccess.com", aud: "aud-tag-123", certsUrl: "https://parkers.cloudflareaccess.com/cdn-cgi/access/certs" });
    expect(accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: "https://parkers.cloudflareaccess.com/", CF_ACCESS_AUD: "x" })?.issuer).toBe("https://parkers.cloudflareaccess.com");
    expect(() => accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: "evil.example", CF_ACCESS_AUD: "x" })).toThrow();
  });
});

describe("the Access token", () => {
  test("a valid one passes", async () => {
    expect(await verifyAccessToken(token(good), cfg, { now: NOW, fetchFn: certs() })).toBe(true);
    // A single-string audience is accepted too.
    expect(await verifyAccessToken(token({ ...good, aud: "aud-tag-123" }), cfg, { now: NOW, fetchFn: certs() })).toBe(true);
  });

  test("wrong audience, issuer or time fails", async () => {
    const f = certs();
    expect(await verifyAccessToken(token({ ...good, aud: ["someone-else"] }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token({ ...good, iss: "https://other.cloudflareaccess.com" }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token({ ...good, exp: nowS - 120 }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token({ ...good, exp: nowS - 30 }), cfg, { now: NOW, fetchFn: f })).toBe(true); // a minute's leeway
    expect(await verifyAccessToken(token({ ...good, nbf: nowS + 120 }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    const noExp: Record<string, unknown> = { ...good };
    delete noExp.exp;
    expect(await verifyAccessToken(token(noExp), cfg, { now: NOW, fetchFn: f })).toBe(false);
  });

  test("a forged or tampered token fails", async () => {
    const f = certs();
    expect(await verifyAccessToken(token(good, { key: other.privateKey }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    const [h, , s] = token(good).split(".");
    expect(await verifyAccessToken(`${h}.${b64({ ...good, email: "mallory@example.com" })}.${s}`, cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token(good, { alg: "HS256" }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(null, cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken("not.a.token", cfg, { now: NOW, fetchFn: f })).toBe(false);
  });

  test("unknown key ids fetch the keys at most once a minute; no keys means closed", async () => {
    const f = certs();
    expect(await verifyAccessToken(token(good, { kid: "unknown-1" }), cfg, { now: NOW, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token(good, { kid: "unknown-2" }), cfg, { now: NOW + 1000, fetchFn: f })).toBe(false);
    expect(await verifyAccessToken(token(good, { kid: "unknown-3" }), cfg, { now: NOW + 2000, fetchFn: f })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    // The known key still works from the cache.
    expect(await verifyAccessToken(token(good), cfg, { now: NOW + 3000, fetchFn: f })).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("requests arriving together share one fetch of the keys", async () => {
    const f = certs();
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyAccessToken(token(good), cfg, { now: NOW, fetchFn: f })));
    expect(results).toEqual([true, true, true, true, true]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("Cloudflare unreachable: closed, retried after a few seconds, not a minute", async () => {
    const down = vi.fn(async () => {
      throw new Error("Cloudflare is down");
    }) as unknown as typeof fetch;
    expect(await checkAccessToken(token(good), cfg, { now: NOW, fetchFn: down })).toEqual({ ok: false, reason: "unknown key" });
    expect(await verifyAccessToken(token(good), cfg, { now: NOW + 1000, fetchFn: down })).toBe(false);
    expect(down).toHaveBeenCalledTimes(1);
    const back = certs();
    expect(await verifyAccessToken(token(good), cfg, { now: NOW + 6000, fetchFn: back })).toBe(true);
  });

  test("each refusal says why", async () => {
    const f = certs();
    expect(await checkAccessToken(null, cfg, { now: NOW, fetchFn: f })).toEqual({ ok: false, reason: "no token" });
    expect(await checkAccessToken(token({ ...good, aud: ["typo"] }), cfg, { now: NOW, fetchFn: f })).toEqual({ ok: false, reason: "wrong audience" });
    expect(await checkAccessToken(token({ ...good, exp: nowS - 600 }), cfg, { now: NOW, fetchFn: f })).toEqual({ ok: false, reason: "expired" });
  });
});
