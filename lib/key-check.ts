import { prisma } from "@/lib/prisma";
import { encryptSecret, hasPreviousKey, openSealed, resealIfPrevious } from "@/lib/crypto";

/**
 * Phase 67c: the \`keys\` background job's own part. A known value sealed in the database (a
 * ServerSecret row, so no table of its own) is opened every tick: when INTEGRATION_ENCRYPTION_KEY
 * isn't the key this database was sealed with (a server started with the wrong settings file, a
 * restore onto a server with other keys), the job fails, the System card says so, and admins get
 * the system reminder within half an hour, instead of bank syncs and school feeds quietly failing.
 *
 * While INTEGRATION_ENCRYPTION_KEY_PREVIOUS is set, it also re-seals every ServerSecret row (the
 * phone-alert keys, this check) with the current key; each app re-seals its own (lib/finance,
 * lib/school/feeds).
 */

export const KEY_CHECK_NAME = "key-check";
const KEY_CHECK_VALUE = "this database's encryption key";

export class WrongKeyError extends Error {
  constructor() {
    super("INTEGRATION_ENCRYPTION_KEY can't open what this database stores: it isn't the key it was sealed with");
    this.name = "WrongKeyError";
  }
}

const row = (r: { encryptedValue: Uint8Array; iv: Uint8Array; authTag: Uint8Array }) => ({
  encryptedValue: Buffer.from(r.encryptedValue),
  iv: Buffer.from(r.iv),
  authTag: Buffer.from(r.authTag),
});
const bytes = (s: { encryptedValue: Buffer; iv: Buffer; authTag: Buffer }) => ({
  encryptedValue: new Uint8Array(s.encryptedValue),
  iv: new Uint8Array(s.iv),
  authTag: new Uint8Array(s.authTag),
});

/** Opens the check value, making it the first time. Throws WrongKeyError when no key opens it. */
export async function checkKey(): Promise<void> {
  const stored = await prisma.serverSecret.findUnique({ where: { name: KEY_CHECK_NAME } });
  if (!stored) {
    await prisma.serverSecret.createMany({ data: [{ name: KEY_CHECK_NAME, ...bytes(encryptSecret(KEY_CHECK_VALUE, KEY_CHECK_NAME)) }], skipDuplicates: true });
    return;
  }
  let plain: string;
  try {
    plain = openSealed(row(stored), KEY_CHECK_NAME).plain.toString("utf8");
  } catch {
    throw new WrongKeyError();
  }
  if (plain !== KEY_CHECK_VALUE) throw new WrongKeyError();
}

/** Re-seals every ServerSecret row the previous key opens (each one's name is its AAD). */
export async function resealServerSecrets(): Promise<{ resealed: number; unreadable: number }> {
  let resealed = 0;
  let unreadable = 0;
  for (const s of await prisma.serverSecret.findMany()) {
    try {
      const moved = resealIfPrevious(row(s), s.name);
      if (!moved) continue;
      // Only if it's still the seal that was read.
      const { count } = await prisma.serverSecret.updateMany({ where: { name: s.name, iv: s.iv }, data: bytes(moved.sealed) });
      if (count) resealed++;
    } catch {
      unreadable++;
    }
  }
  return { resealed, unreadable };
}

/** What the System card says after a run. Pure. */
export function keysDetail(changing: boolean, resealed: number, unreadable: number): string {
  if (!changing) return "the key opens what's stored";
  const parts = [resealed ? `${resealed} re-sealed` : "all on the current key"];
  if (unreadable) parts.push(`${unreadable} no key opens`);
  return parts.join(", ");
}

export { hasPreviousKey };
