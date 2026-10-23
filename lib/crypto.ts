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

export function decryptBytes(secret: EncryptedSecret, aad: string): Buffer {
  if (secret.iv.length !== IV_LENGTH || secret.authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed sealed data: unexpected nonce/tag length.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, secret.iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([decipher.update(secret.encryptedValue), decipher.final()]);
}

export function decryptSecret(secret: EncryptedSecret, aad: string): string {
  // Pinning authTagLength here (rather than trusting the stored tag's own length) stops a
  // DB-write attacker from shortening the tag to weaken forgery resistance.
  if (secret.iv.length !== IV_LENGTH || secret.authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed secret: unexpected iv/authTag length.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, secret.iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([decipher.update(secret.encryptedValue), decipher.final()]).toString("utf8");
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
