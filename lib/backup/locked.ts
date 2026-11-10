import { PRODUCT_NAME } from "@/lib/app-name";

/**
 * A household backup locked with a passphrase (after the 2026-11-10 security review): the file
 * holds meds, contacts, notes and the home location, and ends up wherever the admin saves it.
 * Wrapped like this, it's useless without the passphrase, which is never stored anywhere.
 *
 * Web Crypto only, so the same code runs on the server (the download locks it) and in the
 * browser (a restore unlocks it there, so the passphrase never leaves the device, and the
 * before-restore copy is locked there too). PBKDF2-SHA-256 at 600,000 rounds (OWASP's figure;
 * Web Crypto has no scrypt or Argon2) makes a key for AES-256-GCM. The header (format,
 * version, rounds, salt) is the cipher's additional data, so none of it can be changed
 * without the file failing to open.
 */
export const LOCKED_FORMAT = `${PRODUCT_NAME.toLowerCase()}-locked-backup`;
export const LOCKED_VERSION = 1;
export const PASSPHRASE_MIN = 12;
export const PASSPHRASE_MAX = 200;
const ROUNDS = 600_000;
// What a file may ask for: enough to never open a weak one, few enough that a made-up file
// can't keep the browser busy for minutes.
const MIN_ROUNDS = 300_000;
const MAX_ROUNDS = 5_000_000;

export type LockedBackup = {
  format: typeof LOCKED_FORMAT;
  version: typeof LOCKED_VERSION;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; rounds: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
};

/** What's wrong with a passphrase someone chose, or null. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < PASSPHRASE_MIN) return `Use at least ${PASSPHRASE_MIN} characters: a few words works well.`;
  if (passphrase.length > PASSPHRASE_MAX) return `Use at most ${PASSPHRASE_MAX} characters.`;
  return null;
}

const subtle = () => globalThis.crypto.subtle;
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let out = "";
  // In slices: String.fromCharCode with a whole 20 MB file would overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The parts of the file the cipher vouches for, in a fixed order. */
function header(rounds: number, salt: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([LOCKED_FORMAT, LOCKED_VERSION, "PBKDF2", "SHA-256", rounds, salt, "AES-GCM"]));
}

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>, rounds: number, use: KeyUsage): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", encoder.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, base, { name: "AES-GCM", length: 256 }, false, [use]);
}

/** Locks a backup's text (the plain JSON) with a passphrase; returns the locked file's text. */
export async function lockBackup(plainText: string, passphrase: string): Promise<string> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const saltText = toBase64(salt);
  const key = await keyFor(passphrase, salt, ROUNDS, "encrypt");
  const sealed = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: header(ROUNDS, saltText) }, key, encoder.encode(plainText));
  const file: LockedBackup = {
    format: LOCKED_FORMAT,
    version: LOCKED_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", rounds: ROUNDS, salt: saltText },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(new Uint8Array(sealed)),
  };
  return JSON.stringify(file, null, 2);
}

/** Whether parsed JSON is a locked backup (of any version), not a plain one. */
export function isLockedBackup(json: unknown): boolean {
  return typeof json === "object" && json !== null && (json as { format?: unknown }).format === LOCKED_FORMAT;
}

export type UnlockResult = { ok: true; text: string } | { ok: false; error: string };

/** Opens a locked backup's text with its passphrase. Never throws. */
export async function unlockBackup(lockedText: string, passphrase: string): Promise<UnlockResult> {
  let file: Partial<LockedBackup>;
  try {
    file = JSON.parse(lockedText);
  } catch {
    return { ok: false, error: "The file isn't valid JSON. Is it a backup downloaded from this app?" };
  }
  if (!isLockedBackup(file)) return { ok: false, error: "This file isn't locked." };
  if (file.version !== LOCKED_VERSION) return { ok: false, error: "This backup was locked by a newer version of the app. Update the app first." };
  const rounds = file.kdf?.rounds;
  const salt = file.kdf?.salt;
  const iv = file.cipher?.iv;
  if (
    file.kdf?.name !== "PBKDF2" ||
    file.kdf.hash !== "SHA-256" ||
    file.cipher?.name !== "AES-GCM" ||
    typeof rounds !== "number" ||
    !Number.isInteger(rounds) ||
    rounds < MIN_ROUNDS ||
    rounds > MAX_ROUNDS ||
    typeof salt !== "string" ||
    typeof iv !== "string" ||
    typeof file.data !== "string"
  ) {
    return { ok: false, error: "This locked backup is damaged and can't be opened." };
  }
  try {
    const key = await keyFor(passphrase, fromBase64(salt), rounds, "decrypt");
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(iv), additionalData: header(rounds, salt) }, key, fromBase64(file.data));
    return { ok: true, text: new TextDecoder().decode(plain) };
  } catch {
    // A wrong passphrase and a changed file look the same to AES-GCM.
    return { ok: false, error: "That passphrase doesn't open this backup (or the file was changed)." };
  }
}
