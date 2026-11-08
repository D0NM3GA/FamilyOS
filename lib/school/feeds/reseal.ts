import { prisma } from "@/lib/prisma";
import { resealIfPrevious } from "@/lib/crypto";
import { feedAad } from "./refresh";

/**
 * Phase 67c: while INTEGRATION_ENCRYPTION_KEY_PREVIOUS is set, the \`keys\` job re-seals each school
 * feed's address the previous key opens. A row neither key opens is counted, not changed.
 */
export async function resealSchoolFeeds(): Promise<{ resealed: number; unreadable: number }> {
  let resealed = 0;
  let unreadable = 0;
  const rows = await prisma.schoolFeed.findMany({ select: { id: true, encryptedValue: true, iv: true, authTag: true } });
  for (const r of rows) {
    try {
      const moved = resealIfPrevious({ encryptedValue: Buffer.from(r.encryptedValue), iv: Buffer.from(r.iv), authTag: Buffer.from(r.authTag) }, feedAad(r.id));
      if (!moved) continue;
      // Only if it's still the seal that was read: an address saved again meanwhile is kept.
      const { count } = await prisma.schoolFeed.updateMany({
        where: { id: r.id, iv: r.iv },
        data: { encryptedValue: new Uint8Array(moved.sealed.encryptedValue), iv: new Uint8Array(moved.sealed.iv), authTag: new Uint8Array(moved.sealed.authTag) },
      });
      if (count) resealed++;
    } catch {
      unreadable++;
    }
  }
  return { resealed, unreadable };
}
