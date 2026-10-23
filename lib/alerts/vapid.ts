import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { checkVapid, generateVapidKeys, isVapidSubject, vapidConfig, type Vapid } from "./webpush";

/**
 * Phase 45.2: the phone-alert (VAPID) keys without a step in `.env`. Keys in `.env` still win,
 * so an install that has them keeps them (changing keys means every phone turns alerts on
 * again). Otherwise the server makes a pair once and keeps it in `ServerSecret`, encrypted with
 * INTEGRATION_ENCRYPTION_KEY. webpush.ts stays free of the database; this is its server side.
 */

const NAME = "vapid";

export type VapidState =
  | { ok: true; vapid: Vapid; source: "env" | "stored" }
  | { ok: false; reason: "badEnv" | "badSubject" | "noSubject" | "unreadable" };

/** Set when `.env` carries keys of its own (even broken ones: they're then a fault to fix, not a cue to make new ones). */
const envHasKeys = (env: Record<string, string | undefined>) => Boolean(env.VAPID_PUBLIC_KEY?.trim() || env.VAPID_PRIVATE_KEY?.trim());

/**
 * Who runs this server, for push services: `mailto:` CONTACT_EMAIL, else the app's own address
 * when it's `https://` (the owner's call, 2026-10-22: no family email to Apple, Google or
 * Mozilla unless someone chose to set one). Null on a plain-http install with no contact
 * address: push services want one, so phone alerts stay off there.
 */
export function vapidSubject(env: Record<string, string | undefined> = process.env): string | null {
  const own = env.VAPID_SUBJECT?.trim();
  if (own) return isVapidSubject(own) ? own : null;
  // CONTACT_EMAIL only: NWS_CONTACT_EMAIL, its older name, was given for the weather service.
  const contact = env.CONTACT_EMAIL?.trim();
  if (contact && /^[^@\s]+@[^@\s]+$/.test(contact)) return `mailto:${contact}`;
  const base = env.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");
  if (base && isVapidSubject(base)) return base;
  return null;
}

type StoredPair = { publicKey: string; privateKey: string };

async function readStored(): Promise<StoredPair | "unreadable" | null> {
  const row = await prisma.serverSecret.findUnique({ where: { name: NAME } });
  if (!row) return null;
  try {
    const pair = JSON.parse(decryptSecret({ encryptedValue: Buffer.from(row.encryptedValue), iv: Buffer.from(row.iv), authTag: Buffer.from(row.authTag) }, NAME)) as StoredPair;
    return typeof pair.publicKey === "string" && typeof pair.privateKey === "string" ? pair : "unreadable";
  } catch {
    // INTEGRATION_ENCRYPTION_KEY changed since the pair was made. Never replaced silently:
    // every phone's subscription was made with the old public key (Settings → Alerts offers it).
    console.warn("[alerts] The stored phone-alert keys can't be read with this INTEGRATION_ENCRYPTION_KEY.");
    return "unreadable";
  }
}

/** Makes and stores a pair, or reads back the one a request racing this one stored first. */
async function createStored(): Promise<StoredPair | "unreadable" | null> {
  const pair = generateVapidKeys();
  const sealed = encryptSecret(JSON.stringify(pair), NAME);
  try {
    await prisma.serverSecret.create({
      data: { name: NAME, encryptedValue: new Uint8Array(sealed.encryptedValue), iv: new Uint8Array(sealed.iv), authTag: new Uint8Array(sealed.authTag) },
    });
    return pair;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return readStored();
    throw err;
  }
}

/**
 * The keys and where they came from, or why there are none. Makes the stored pair the first time
 * it's asked, so a page showing "This phone" can hand its public key to the browser; the
 * unique name and the read-back in createStored make that safe for concurrent first requests.
 */
export async function getVapidState(env: Record<string, string | undefined> = process.env): Promise<VapidState> {
  // A VAPID_SUBJECT that isn't mailto: or https: is the server owner's to fix; it says nothing
  // about the keys, so it must never look like unreadable keys (whose fix clears every phone).
  if (env.VAPID_SUBJECT?.trim() && !isVapidSubject(env.VAPID_SUBJECT.trim())) return { ok: false, reason: "badSubject" };
  const subject = vapidSubject(env);
  if (envHasKeys(env)) {
    const vapid = vapidConfig({ ...env, VAPID_SUBJECT: subject ?? undefined });
    return vapid ? { ok: true, vapid, source: "env" } : { ok: false, reason: "badEnv" };
  }
  if (!subject) return { ok: false, reason: "noSubject" };
  const pair = (await readStored()) ?? (await createStored());
  if (pair === "unreadable" || pair === null) return { ok: false, reason: "unreadable" };
  const vapid = checkVapid(pair.publicKey, pair.privateKey, subject);
  return vapid ? { ok: true, vapid, source: "stored" } : { ok: false, reason: "unreadable" };
}

/** The keys to send with, or null when phone alerts can't work on this install. */
export async function getVapid(): Promise<Vapid | null> {
  const state = await getVapidState();
  return state.ok ? state.vapid : null;
}

/**
 * Settings → Alerts' "Make new phone-alert keys" (an admin, asked first): a fresh stored pair.
 * Every phone was subscribed with the old public key, so those subscriptions go too and each
 * person turns alerts on again. Does nothing when `.env` holds the keys.
 */
export async function replaceStoredVapid(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (envHasKeys(env)) return;
  const sealed = encryptSecret(JSON.stringify(generateVapidKeys()), NAME);
  const data = { encryptedValue: new Uint8Array(sealed.encryptedValue), iv: new Uint8Array(sealed.iv), authTag: new Uint8Array(sealed.authTag) };
  // One transaction: the new pair is in place before any phone's subscription goes, or nothing
  // changes. The keys belong to the server, and one server runs one household (lib/setup.ts),
  // so every subscription on it was made with them.
  await prisma.$transaction([
    prisma.serverSecret.upsert({ where: { name: NAME }, create: { name: NAME, ...data }, update: { ...data, createdAt: new Date() } }),
    prisma.pushSubscription.deleteMany({}),
  ]);
}
