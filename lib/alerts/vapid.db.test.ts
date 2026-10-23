import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { generateVapidKeys } from "./webpush";
import { getVapidState, replaceStoredVapid, vapidSubject } from "./vapid";

/**
 * Phase 45.2: the server's own phone-alert keys against a real database (`npm run test:db`).
 * The env is passed in, so the machine's own `.env` keys don't decide anything here.
 */
const RUN = import.meta.env.MODE === "db";
const HTTPS = { BETTER_AUTH_URL: "https://family.example" };

describe("who runs this server (pure)", () => {
  test("CONTACT_EMAIL, else an https address, else nothing", () => {
    expect(vapidSubject({ CONTACT_EMAIL: "owner@example.com", BETTER_AUTH_URL: "https://family.example" })).toBe("mailto:owner@example.com");
    // The weather service's older contact setting is never sent to push services.
    expect(vapidSubject({ NWS_CONTACT_EMAIL: "owner@example.com" })).toBeNull();
    expect(vapidSubject({ BETTER_AUTH_URL: "https://family.example/app" })).toBe("https://family.example/app");
    expect(vapidSubject({ VAPID_SUBJECT: "me@example.com" })).toBeNull();
    expect(vapidSubject({ CONTACT_EMAIL: "", BETTER_AUTH_URL: "https://family.example/" })).toBe("https://family.example");
    expect(vapidSubject({ BETTER_AUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(vapidSubject({ CONTACT_EMAIL: "not an email" })).toBeNull();
    expect(vapidSubject({ VAPID_SUBJECT: "mailto:set@example.com", CONTACT_EMAIL: "owner@example.com" })).toBe("mailto:set@example.com");
  });
});

describe.skipIf(!RUN)("the server's own phone-alert keys (database)", () => {
  let kept: { name: string; encryptedValue: Uint8Array; iv: Uint8Array; authTag: Uint8Array } | null = null;
  const h = { id: "", person: "" };

  beforeAll(async () => {
    kept = await prisma.serverSecret.findUnique({ where: { name: "vapid" }, select: { name: true, encryptedValue: true, iv: true, authTag: true } });
    const household = await prisma.household.create({ data: { name: `vapid-${Date.now()}` } });
    const person = await prisma.person.create({ data: { householdId: household.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    Object.assign(h, { id: household.id, person: person.id });
  });
  beforeEach(async () => {
    await prisma.serverSecret.deleteMany({ where: { name: "vapid" } });
  });
  afterAll(async () => {
    await prisma.serverSecret.deleteMany({ where: { name: "vapid" } });
    if (kept) await prisma.serverSecret.create({ data: { name: kept.name, encryptedValue: new Uint8Array(kept.encryptedValue), iv: new Uint8Array(kept.iv), authTag: new Uint8Array(kept.authTag) } });
    await prisma.household.deleteMany({ where: { id: h.id } });
  });

  test("made once, stored encrypted, then reused", async () => {
    const first = await getVapidState(HTTPS);
    expect(first).toMatchObject({ ok: true, source: "stored" });
    const row = await prisma.serverSecret.findUniqueOrThrow({ where: { name: "vapid" } });
    expect(Buffer.from(row.encryptedValue).toString("utf8")).not.toContain(first.ok ? first.vapid.privateKey : "x");
    const again = await getVapidState(HTTPS);
    expect(again.ok && first.ok && again.vapid.publicKey).toBe(first.ok && first.vapid.publicKey);
  });

  test("two first requests at once end up with the same pair", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => getVapidState(HTTPS)));
    const keys = new Set(results.map((r) => (r.ok ? r.vapid.publicKey : "none")));
    expect(keys.size).toBe(1);
    expect(keys.has("none")).toBe(false);
    expect(await prisma.serverSecret.count({ where: { name: "vapid" } })).toBe(1);
  });

  test("keys in .env win, and broken ones are a fault, not a cue to make new ones", async () => {
    const env = generateVapidKeys();
    expect(await getVapidState({ ...HTTPS, VAPID_PUBLIC_KEY: env.publicKey, VAPID_PRIVATE_KEY: env.privateKey })).toMatchObject({ ok: true, source: "env", vapid: { publicKey: env.publicKey } });
    expect(await getVapidState({ ...HTTPS, VAPID_PUBLIC_KEY: env.publicKey })).toEqual({ ok: false, reason: "badEnv" });
    expect(await prisma.serverSecret.count({ where: { name: "vapid" } })).toBe(0);
  });

  test("a malformed VAPID_SUBJECT is its own fault, never \"unreadable\" (whose fix clears every phone)", async () => {
    expect(await getVapidState({ ...HTTPS, VAPID_SUBJECT: "owner@example.com" })).toEqual({ ok: false, reason: "badSubject" });
    expect(await prisma.serverSecret.count({ where: { name: "vapid" } })).toBe(0);
  });

  test("no contact address on plain http: nothing is made", async () => {
    expect(await getVapidState({ BETTER_AUTH_URL: "http://localhost:3000" })).toEqual({ ok: false, reason: "noSubject" });
    expect(await prisma.serverSecret.count({ where: { name: "vapid" } })).toBe(0);
  });

  test("unreadable keys are never replaced silently; an admin's reset replaces them and the phones", async () => {
    // Sealed under another name, as if INTEGRATION_ENCRYPTION_KEY had changed: it won't open.
    const sealed = encryptSecret(JSON.stringify(generateVapidKeys()), "not-vapid");
    await prisma.serverSecret.create({ data: { name: "vapid", encryptedValue: new Uint8Array(sealed.encryptedValue), iv: new Uint8Array(sealed.iv), authTag: new Uint8Array(sealed.authTag) } });
    await prisma.pushSubscription.create({ data: { personId: h.person, endpoint: `https://fcm.googleapis.com/fcm/send/vapid-${Date.now()}`, p256dh: "x", auth: "y" } });

    expect(await getVapidState(HTTPS)).toEqual({ ok: false, reason: "unreadable" });
    expect(await getVapidState(HTTPS)).toEqual({ ok: false, reason: "unreadable" });

    await replaceStoredVapid(HTTPS);
    expect(await getVapidState(HTTPS)).toMatchObject({ ok: true, source: "stored" });
    expect(await prisma.pushSubscription.count({ where: { personId: h.person } })).toBe(0);
  });
});
