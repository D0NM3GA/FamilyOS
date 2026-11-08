import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM-standard 96-bit nonce.
const KEY_LENGTH = 32; // AES-256.
const AUTH_TAG_LENGTH = 16; // GCM's full 128-bit tag — Node accepts shorter ones unless pinned.

/**
 * A dedicated key for encrypting third-party secrets at rest (a jar's SimpleFIN/Privacy.com
 * connection, a school feed address, the Teams workflow link) — deliberately NOT
 * BETTER_AUTH_SECRET or the Entra client secret. Different blast radius (rotating one shouldn't force re-encrypting the other's data)
 * and no reuse of one key across unrelated cryptographic purposes. Validated at module
 * load, like lib/auth.ts's Microsoft settings check (lib/microsoft-config.ts), rather than failing lazily on
 * first use.
 */
const rawKey = process.env.INTEGRATION_ENCRYPTION_KEY;
if (!rawKey) {
  throw new Error(
    "INTEGRATION_ENCRYPTION_KEY is not set. Generate one with " +
      "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
      "— see docs/BUILD.md Phase 4.5.",
  );
}
const key = Buffer.from(rawKey, "base64");
if (key.length !== KEY_LENGTH) {
  throw new Error(
    `INTEGRATION_ENCRYPTION_KEY must decode (base64) to exactly ${KEY_LENGTH} bytes, got ${key.length}.`,
  );
}

/**
 * Phase 67c: the key before a change of key, set only while changing it (README "Changing the
 * encryption key"). Anything the current key can't open is tried with this one, so old rows and
 * old backups' money sections still open; the `keys` background job re-seals the stored ones with
 * the current key (lib/key-check.ts). Checked at start like the current key.
 */
const rawPrevious = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS?.trim();
const previousKey = rawPrevious ? Buffer.from(rawPrevious, "base64") : null;
if (previousKey && previousKey.length !== KEY_LENGTH) {
  throw new Error(`INTEGRATION_ENCRYPTION_KEY_PREVIOUS must decode (base64) to exactly ${KEY_LENGTH} bytes, got ${previousKey.length}.`);
}
if (previousKey && previousKey.equals(key)) {
  throw new Error("INTEGRATION_ENCRYPTION_KEY_PREVIOUS is the same as INTEGRATION_ENCRYPTION_KEY. Set it to the old key, or remove it.");
}

/** Whether a previous key is set (a change of key is under way). */
export function hasPreviousKey(): boolean {
  return previousKey !== null;
}

export type EncryptedSecret = { encryptedValue: Buffer; iv: Buffer; authTag: Buffer };

/**
 * `aad` binds the ciphertext to the row it belongs to (each caller builds its own, e.g.
 * lib/finance/sync.ts's `aad(jarId, provider)`) so a ciphertext copied into a different row fails to decrypt instead of silently decrypting as someone else's secret.
 */
export function encryptSecret(plaintext: string, aad: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encryptedValue = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { encryptedValue, iv, authTag: cipher.getAuthTag() };
}

/** Phase 28: the same cipher over bytes (a gzipped backup section), for lib/finance/backup.ts. */
export function encryptBytes(plaintext: Buffer, aad: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encryptedValue = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { encryptedValue, iv, authTag: cipher.getAuthTag() };
}

function openWith(k: Buffer, secret: EncryptedSecret, aad: string): Buffer {
  // Pinning authTagLength here (rather than trusting the stored tag's own length) stops a
  // DB-write attacker from shortening the tag to weaken forgery resistance.
  const decipher = createDecipheriv(ALGORITHM, k, secret.iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([decipher.update(secret.encryptedValue), decipher.final()]);
}

/**
 * Opens a seal with the current key, else (Phase 67c) the previous one, saying which. GCM's tag
 * makes the wrong key fail cleanly, so trying both is safe. Throws when neither opens it.
 */
export function openSealed(secret: EncryptedSecret, aad: string): { plain: Buffer; withPrevious: boolean } {
  if (secret.iv.length !== IV_LENGTH || secret.authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed sealed data: unexpected nonce/tag length.");
  }
  try {
    return { plain: openWith(key, secret, aad), withPrevious: false };
  } catch (err) {
    if (!previousKey) throw err;
    return { plain: openWith(previousKey, secret, aad), withPrevious: true };
  }
}

export function decryptBytes(secret: EncryptedSecret, aad: string): Buffer {
  return openSealed(secret, aad).plain;
}

export function decryptSecret(secret: EncryptedSecret, aad: string): string {
  return openSealed(secret, aad).plain.toString("utf8");
}

/**
 * Phase 67c: a seal the previous key made, made again with the current one; null when the current
 * key already opens it. Throws when neither key does.
 */
export function resealIfPrevious(secret: EncryptedSecret, aad: string): { sealed: EncryptedSecret; plain: string } | null {
  const opened = openSealed(secret, aad);
  if (!opened.withPrevious) return null;
  const plain = opened.plain.toString("utf8");
  return { sealed: encryptSecret(plain, aad), plain };
}

/**
 * Phase 30: a stable, non-reversible fingerprint of a secret (a Privacy.com key), so the same
 * account connected twice can be found by equality without decrypting every row. HMAC-SHA256
 * with a key derived (HKDF) from INTEGRATION_ENCRYPTION_KEY for this purpose alone.
 */
export function fingerprint(label: string, value: string): string {
  const k = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), `familyos:fingerprint:${label}`, 32));
  return createHmac("sha256", k).update(value, "utf8").digest("hex");
}
