import { after } from "next/server";
import { buildBackup } from "@/lib/backup/build";
import { BACKUP_CARD, recordBackupEvent } from "@/lib/backup/audit";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import { sealMoney } from "@/lib/finance/backup";
import { authorizeExport, downloadResponse, exportDateStamp } from "@/lib/export";

/**
 * The whole-household backup (Phase 16): ADMIN only. Fixed ASCII filename; the household
 * name is inside the file, never in a header.
 *
 * Phase 28: a POST from /data by the admin themselves, signed in within 15 minutes
 * (lib/export.ts sensitive). Money jars ride along sealed (lib/finance/backup.ts): this
 * route is the one place the household backup and money meet, on purpose. The download is
 * recorded (with the hash of exactly these bytes) before it's sent, and the other admins
 * and every jar member are told.
 */
export async function POST(request: Request) {
  const auth = await authorizeExport(request, "admin", { stepUpPath: "/data" });
  if (auth.response) return auth.response;
  const { viewer } = auth;

  const backup = await buildBackup(viewer.householdId, new Date(), { sealMoney });
  const text = JSON.stringify(backup, null, 2);
  const { notificationIds } = await recordBackupEvent({
    householdId: viewer.householdId,
    actorId: viewer.id,
    actorName: viewer.firstName,
    kind: "HOUSEHOLD_BACKUP",
    includesMoney: backup.sealedMoney != null,
    jarCount: backup.sealedMoney?.jarCount ?? 0,
    fileText: text,
  });
  after(() => deliverNotifications({ id: { in: notificationIds } }, { channels: "teams-first", card: BACKUP_CARD }));
  return downloadResponse(text, `familyos-backup-${exportDateStamp()}.json`, "application/json; charset=utf-8");
}
