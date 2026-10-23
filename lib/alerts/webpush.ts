import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "crypto";

/**
 * Phase 21.6: Web Push from Node built-ins only — VAPID (RFC 8292) to identify this server to
 * the push service, and aes128gcm payload encryption (RFC 8291) so only the phone can read
 * the message. Unit-tested against RFC 8291 Appendix A.
 *
 * The endpoint URL is a bearer capability for one device, so it never appears in an error,
 * a log line or Sentry (lib/observability/options.ts ignores the push hosts).
 */

const RS = 4096;
const HEADER_LEN = 16 + 4 + 1 + 65;
/** Push services cap the whole body at 4096 bytes: header 86 + delimiter 1 + tag 16. */
export const MAX_PLAINTEXT = 4096 - HEADER_LEN - 17;

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, len: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, len));
}

/** RFC 8291 §3.4 single-record aes128gcm body. salt / asPrivateKey are injectable for tests. */
export function encryptPayload(
  plaintext: Buffer,
  uaPublic: Buffer,
  authSecret: Buffer,
  opts: { salt?: Buffer; asPrivateKey?: Buffer } = {},
): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("Push message is too long.");
  const salt = opts.salt ?? randomBytes(16);
  const as = createECDH("prime256v1");
  if (opts.asPrivateKey) as.setPrivateKey(opts.asPrivateKey);
  else as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdhSecret = as.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce, { authTagLength: 16 });
  // Single (final) record: plaintext then the 0x02 delimiter, no further padding.
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(HEADER_LEN);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header.writeUInt8(65, 20);
  asPublic.copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}

// ---------- VAPID ----------

export type Vapid = { publicKey: string; privateKey: string; subject: string };

/**
 * Who runs this server, as push services want it: `mailto:` an address, or (Phase 45.2) the
 * app's own `https://` address, so no family email has to go to Apple, Google or Mozilla.
 */
export const isVapidSubject = (subject: string) => /^mailto:[^@\s]+@[^@\s]+$/.test(subject) || /^https:\/\/[^\s/]+(\/\S*)?$/.test(subject);

/** The server's VAPID keys from `.env`, or null when missing or inconsistent (public must match private). */
export function vapidConfig(env: Record<string, string | undefined> = process.env): Vapid | null {
  return checkVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
}

/** A key pair and subject, checked and made canonical, or null. Pure: lib/alerts/vapid.ts stores generated pairs. */
export function checkVapid(publicKey: string | undefined, privateKey: string | undefined, subject: string | undefined): Vapid | null {
  publicKey = publicKey?.trim();
  privateKey = privateKey?.trim();
  subject = subject?.trim();
  if (!publicKey || !privateKey || !subject || !isVapidSubject(subject)) return null;
  try {
    // Node prints a private key without leading zero bytes (~1 in 256 keys is 31 bytes),
    // so pad back to 32 rather than rejecting a perfectly good key.
    const raw = unb64u(privateKey);
    if (raw.length < 1 || raw.length > 32) return null;
    const d = Buffer.concat([Buffer.alloc(32 - raw.length), raw]);
    const derived = createECDH("prime256v1");
    derived.setPrivateKey(d);
    const pub = derived.getPublicKey();
    // A mismatched .env would make every push fail with 401s; treat it as "not set up".
    if (!pub.equals(unb64u(publicKey))) return null;
    // Canonical unpadded base64url downstream: `k=` and the JWK `d` must not carry "=".
    return { publicKey: b64u(pub), privateKey: b64u(d), subject };
  } catch {
    return null;
  }
}

/** A fresh key pair (Phase 45.2: the server makes its own when `.env` has none). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const e = createECDH("prime256v1");
  e.generateKeys();
  const d = e.getPrivateKey();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(Buffer.concat([Buffer.alloc(32 - d.length), d])) };
}

const jwtCache = new Map<string, { token: string; until: number }>();

/** The `vapid t=…, k=…` Authorization value for an endpoint's origin (cached ~1h). */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now: number = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${aud}|${vapid.publicKey}|${vapid.subject}`;
  const hit = jwtCache.get(cacheKey);
  if (hit && hit.until > now) return `vapid t=${hit.token}, k=${vapid.publicKey}`;

  const pub = unb64u(vapid.publicKey);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // exp 12h: RFC 8292 and Apple both reject anything past 24h.
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })));
  const data = Buffer.from(`${header}.${claims}`);
  const signature = sign("sha256", data, { key, dsaEncoding: "ieee-p1363" });
  const token = `${header}.${claims}.${b64u(signature)}`;
  jwtCache.set(cacheKey, { token, until: now + 3600_000 });
  return `vapid t=${token}, k=${vapid.publicKey}`;
}

// ---------- Endpoints ----------

const EXACT_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

/** Only the real browser push services: https, no userinfo, no port. */
export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (host.startsWith(".") || host.endsWith(".")) return false;
  return EXACT_HOSTS.includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

/** p256dh must be an uncompressed point actually on P-256. */
export function isValidUaPublicKey(p256dh: Buffer): boolean {
  if (p256dh.length !== 65 || p256dh[0] !== 4) return false;
  try {
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(p256dh);
    return true;
  } catch {
    return false;
  }
}

// ---------- Sending ----------

export type PushOutcome = "ok" | "gone" | "badVapid" | "rejected" | "transient";
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/**
 * Sends one encrypted notification. Status mapping: 2xx ok; 404/410 gone (delete the
 * device); 401/403 badVapid (the server's keys, not the device's fault); other 4xx
 * rejected (counts toward deleting the device); 429/5xx/network transient (doesn't count).
 */
export async function sendPush(
  sub: PushTarget,
  payload: { title: string; body: string; path: string },
  deps: { fetchFn?: typeof fetch; vapid?: Vapid | null } = {},
): Promise<PushOutcome> {
  // Phase 45.2: callers pass the keys (lib/alerts/vapid.ts getVapid), which may be stored ones.
  const vapid = deps.vapid === undefined ? vapidConfig() : deps.vapid;
  if (!vapid) return "badVapid";
  if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";

  const plaintext = Buffer.from(JSON.stringify(payload));
  // Our message being too long is our problem, not the device's: never delete it for that.
  if (plaintext.length > MAX_PLAINTEXT) return "rejected";
  let body: Buffer;
  try {
    body = encryptPayload(plaintext, unb64u(sub.p256dh), unb64u(sub.auth));
  } catch {
    // An off-curve key (or bad auth) will never work for this device.
    return "gone";
  }

  let res: Response;
  try {
    res = await (deps.fetchFn ?? fetch)(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: "86400",
        Urgency: "high",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: vapidAuthorization(sub.endpoint, vapid),
      },
      body: new Uint8Array(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "transient";
  }
  if (res.ok) return "ok";
  if (res.status === 404 || res.status === 410) return "gone";
  if (res.status === 401 || res.status === 403) return "badVapid";
  if (res.status === 429 || res.status >= 500) return "transient";
  return "rejected";
}
