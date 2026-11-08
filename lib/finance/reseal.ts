import { prisma } from "@/lib/prisma";
import { fingerprint, resealIfPrevious } from "@/lib/crypto";
import { aad } from "./sync";

/**
 * Phase 67c: while INTEGRATION_ENCRYPTION_KEY_PREVIOUS is set, the \`keys\` job re-seals each bank
 * and card connection the previous key opens, and gives a Privacy.com key its fingerprint from the
 * current key (fingerprints are made from it too: lib/crypto.ts), so connecting the same account
 * twice is still caught. A row neither key opens is counted, not changed.
 */
export async function resealJarConnections(): Promise<{ resealed: number; unreadable: number }> {
  let resealed = 0;
  let unreadable = 0;
  const rows = await prisma.jarConnection.findMany({ select: { id: true, jarId: true, provider: true, encryptedValue: true, iv: true, authTag: true } });
  for (const r of rows) {
    try {
      const moved = resealIfPrevious({ encryptedValue: Buffer.from(r.encryptedValue), iv: Buffer.from(r.iv), authTag: Buffer.from(r.authTag) }, aad(r.jarId, r.provider));
      if (!moved) continue;
      // Only if it's still the seal that was read (its nonce is unique): a connection saved again
      // meanwhile keeps its new secret.
      const { count } = await prisma.jarConnection.updateMany({
        where: { id: r.id, iv: r.iv },
        data: {
          encryptedValue: new Uint8Array(moved.sealed.encryptedValue),
          iv: new Uint8Array(moved.sealed.iv),
          authTag: new Uint8Array(moved.sealed.authTag),
          ...(r.provider === "PRIVACY" ? { fingerprint: fingerprint("privacy", moved.plain) } : {}),
        },
      });
      if (count) resealed++;
    } catch {
      unreadable++;
    }
  }
  return { resealed, unreadable };
}
