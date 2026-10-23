import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { claimConnections, syncConnection } from "./sync";
import { evaluateMoneyAlerts } from "./alerts";
import { decryptSecret, fingerprint } from "@/lib/crypto";
import { aad } from "./sync";
import { householdWithAppOn } from "@/lib/app-switches";

const ALERT_MEMORY_DAYS = 400;

/**
 * Phase 27: the money side of the background jobs (lib/background.ts). Outside any request,
 * so nothing here may use after(), cookies() or revalidatePath (schedule.ts uses after(), so
 * it isn't used). Syncs every connection that's due by the same 6-hour rule and leases as
 * an on-visit sync (so two app instances can't both sync one), then sends alerts.
 *
 * Phase 36: families with Money turned off are skipped, syncs and alerts both (the owner's
 * call: turning an app off pauses its background work). The clean-up below still runs: it
 * only forgets markers too old to matter.
 */
export async function runMoneyJobs(now: Date = new Date()): Promise<void> {
  const jars = await prisma.moneyJar.findMany({ where: { household: householdWithAppOn("money") }, select: { id: true } });
  for (const jar of jars) {
    const claimed = await claimConnections(jar.id, { force: false, now }).catch(() => {
      captureError(new Error(`money jar background sync couldn't claim (jar ${jar.id})`));
      return [] as string[];
    });
    for (const id of claimed) {
      try {
        await syncConnection(id);
      } catch {
        captureError(new Error(`money jar background sync failed (connection ${id})`));
      }
    }
  }
  await backfillFingerprints();
  await evaluateMoneyAlerts(now);
  // Alert keys name a day or month, so a marker this old can never match again.
  await prisma.finAlertSent.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - ALERT_MEMORY_DAYS * 86_400_000) } } });
  await prisma.jarChatAlertSent.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - ALERT_MEMORY_DAYS * 86_400_000) } } });
  // Phase 30: jar history is kept for about a year.
  await prisma.jarEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - ALERT_MEMORY_DAYS * 86_400_000) } } });
}

/** Phase 30: Privacy.com keys saved before fingerprints existed get one (connectPrivacy's guard). */
async function backfillFingerprints() {
  const rows = await prisma.jarConnection.findMany({ where: { provider: "PRIVACY", fingerprint: null }, select: { id: true, jarId: true, provider: true, encryptedValue: true, iv: true, authTag: true } });
  for (const r of rows) {
    try {
      const secret = decryptSecret({ encryptedValue: Buffer.from(r.encryptedValue), iv: Buffer.from(r.iv), authTag: Buffer.from(r.authTag) }, aad(r.jarId, r.provider));
      await prisma.jarConnection.update({ where: { id: r.id }, data: { fingerprint: fingerprint("privacy", secret) } });
    } catch {
      captureError(new Error(`privacy fingerprint backfill failed (connection ${r.id})`));
      // Never matches a real fingerprint (those are hex); the next save sets a real one.
      await prisma.jarConnection.update({ where: { id: r.id }, data: { fingerprint: "unreadable" } }).catch(() => {});
    }
  }
}
