import { createECDH, createPublicKey, verify } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_PLAINTEXT,
  encryptPayload,
  isAllowedPushEndpoint,
  isValidUaPublicKey,
  sendPush,
  vapidAuthorization,
  vapidConfig,
  checkVapid,
  generateVapidKeys,
} from "./webpush";
import { isPrivateOutgoingRequest } from "@/lib/observability/options";

const u = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "base64url");

// RFC 8291 Section 5 / Appendix A, copied verbatim (whitespace removed by `u`).
const RFC = {
  plaintext: u("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
  asPrivate: u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  asPublic: u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
  uaPublic: u("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
  salt: u("DGv6ra1nlYgDCS1FRnbzlw"),
  auth: u("BTBZMqHH6r4Tts7J_aSIgg"),
  header: u("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8"),
  ciphertext: u("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ"),
  body: u(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
};

describe("RFC 8291 aes128gcm", () => {
  it("reproduces Appendix A exactly", () => {
    const out = encryptPayload(RFC.plaintext, RFC.uaPublic, RFC.auth, { salt: RFC.salt, asPrivateKey: RFC.asPrivate });
    expect(out.subarray(0, 86).equals(RFC.header)).toBe(true);
    expect(out.subarray(86).equals(RFC.ciphertext)).toBe(true);
    expect(out.equals(RFC.body)).toBe(true);
    expect(out.length).toBe(86 + RFC.plaintext.length + 1 + 16);
  });

  it("caps the plaintext so the whole body fits 4096 bytes", () => {
    expect(MAX_PLAINTEXT).toBe(3993);
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT + 1), RFC.uaPublic, RFC.auth)).toThrow();
    expect(encryptPayload(Buffer.alloc(MAX_PLAINTEXT), RFC.uaPublic, RFC.auth).length).toBe(4096);
  });
});

function keyPair() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  const d = e.getPrivateKey();
  return { publicKey: e.getPublicKey().toString("base64url"), privateKey: Buffer.concat([Buffer.alloc(32 - d.length), d]).toString("base64url") };
}

describe("VAPID", () => {
  it("only accepts a matching key pair and a mailto or https subject", () => {
    const k = keyPair();
    const other = keyPair();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "mailto:a@b.co" })).not.toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: other.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "mailto:a@b.co" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "https://family.example" })).not.toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "http://family.example" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "https://" })).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "mailto:nobody" })).toBeNull();
    expect(vapidConfig({})).toBeNull();
  });

  it("generates a pair that checks out", () => {
    const g = generateVapidKeys();
    expect(checkVapid(g.publicKey, g.privateKey, "https://family.example")).toEqual({ ...g, subject: "https://family.example" });
    expect(generateVapidKeys().privateKey).not.toBe(g.privateKey);
  });

  it("accepts a private key Node printed without its leading zero byte, and returns canonical values", () => {
    // Find a key whose raw private scalar is under 32 bytes (about 1 in 256).
    let e = createECDH("prime256v1");
    for (let i = 0; i < 5000; i++) {
      e = createECDH("prime256v1");
      e.generateKeys();
      if (e.getPrivateKey().length < 32) break;
    }
    expect(e.getPrivateKey().length).toBeLessThan(32);
    const cfg = vapidConfig({
      VAPID_PUBLIC_KEY: e.getPublicKey().toString("base64url") + "=",
      VAPID_PRIVATE_KEY: e.getPrivateKey().toString("base64url"),
      VAPID_SUBJECT: "mailto:a@b.co",
    });
    expect(cfg).not.toBeNull();
    expect(Buffer.from(cfg!.privateKey, "base64url").length).toBe(32);
    expect(cfg!.publicKey).not.toContain("=");
    expect(vapidAuthorization("https://web.push.apple.com/x", cfg!)).toMatch(/^vapid t=.+, k=[A-Za-z0-9_-]+$/);
  });

  it("signs an ES256 JWT for the endpoint's origin that verifies with the public key", () => {
    const k = keyPair();
    const vapid = { ...k, subject: "mailto:a@b.co" };
    const now = 1_790_000_000_000;
    const auth = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(m[2]).toBe(k.publicKey);
    const [h, c, s] = m[1].split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:a@b.co" });
    const pub = Buffer.from(k.publicKey, "base64url");
    const publicKey = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
      format: "jwk",
    });
    const sig = Buffer.from(s, "base64url");
    expect(sig.length).toBe(64);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
  });
});

describe("push endpoints", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QABC",
    "https://wns2-by3p.notify.windows.com/w/?token=abc",
  ])("allows %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
    // And Sentry never records it (the path or query is the device's capability).
    expect(isPrivateOutgoingRequest(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evil-fcm.googleapis.com/x",
    "https://notify.windows.com/x",
    "https://push.apple.com/x",
    "https://..push.apple.com/x",
    "https://me:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });

  it("checks p256dh is a real P-256 point", () => {
    expect(isValidUaPublicKey(RFC.uaPublic)).toBe(true);
    const bad = Buffer.from(RFC.uaPublic);
    bad[64] ^= 1;
    expect(isValidUaPublicKey(bad)).toBe(false);
    expect(isValidUaPublicKey(Buffer.alloc(65, 4))).toBe(false);
  });
});

describe("sendPush", () => {
  const vapid = { ...keyPair(), subject: "mailto:a@b.co" };
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/SECRET-TOKEN",
    p256dh: RFC.uaPublic.toString("base64url"),
    auth: RFC.auth.toString("base64url"),
  };
  const payload = { title: "FamilyOS", body: "Ivy bought DJ", path: "/points#orders" };

  it("posts an encrypted body with the right headers", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendPush(sub, payload, { fetchFn: fetchFn as unknown as typeof fetch, vapid })).toBe("ok");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(sub.endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("86400");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(init.redirect).toBe("error");
    expect((init.body as Uint8Array).length).toBe(86 + Buffer.byteLength(JSON.stringify(payload)) + 17);
  });

  it.each([
    [404, "gone"],
    [410, "gone"],
    [401, "badVapid"],
    [403, "badVapid"],
    [400, "rejected"],
    [413, "rejected"],
    [429, "transient"],
    [503, "transient"],
  ])("maps %i to %s", async (status, outcome) => {
    const fetchFn = vi.fn(async () => new Response(null, { status }));
    expect(await sendPush(sub, payload, { fetchFn: fetchFn as unknown as typeof fetch, vapid })).toBe(outcome);
  });

  it("treats a network failure as transient and never throws the endpoint", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError(`fetch failed ${sub.endpoint}`);
    });
    await expect(sendPush(sub, payload, { fetchFn: fetchFn as unknown as typeof fetch, vapid })).resolves.toBe("transient");
  });

  it("never deletes a device because our own message was too long", async () => {
    const fetchFn = vi.fn();
    const long = { ...payload, body: "x".repeat(5000) };
    expect(await sendPush(sub, long, { fetchFn: fetchFn as unknown as typeof fetch, vapid })).toBe("rejected");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses without VAPID keys or with an off-list endpoint", async () => {
    const fetchFn = vi.fn();
    expect(await sendPush(sub, payload, { fetchFn: fetchFn as unknown as typeof fetch, vapid: null })).toBe("badVapid");
    expect(await sendPush({ ...sub, endpoint: "https://evil.example/x" }, payload, { fetchFn: fetchFn as unknown as typeof fetch, vapid })).toBe("gone");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
