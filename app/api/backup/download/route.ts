import { after } from "next/server";
import { buildBackup } from "@/lib/backup/build";
import { BACKUP_CARD, recordBackupEvent } from "@/lib/backup/audit";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import { sealMoney } from "@/lib/finance/backup";
import { authorizeExport, downloadResponse, exportDateStamp } from "@/lib/export";
import { lockBackup, passphraseProblem } from "@/lib/backup/locked";
import { NextResponse } from "next/server";

/**
 * The whole-household backup (Phase 16): ADMIN only. Fixed ASCII filename; the household
 * name is inside the file, never in a header.
 *
 * Phase 28: a POST from /data by the admin themselves, signed in within 15 minutes
 * (lib/export.ts sensitive). Money jars ride along sealed (lib/finance/backup.ts): this
 * route is the one place the household backup and money meet, on purpose. The download is
 * recorded (with the hash of exactly these bytes) before it's sent, and the other admins
 * and every jar member are told.
 *
 * After the 2026-11-10 security review the file is locked with a passphrase the admin types on
 * /data (lib/backup/locked.ts): it's never stored, so the server can't open the file either.
 */
export async function POST(request: Request) {
  const auth = await authorizeExport(request, "admin", { stepUpPath: "/data" });
  if (auth.response) return auth.response;
  const { viewer } = auth;

  // The page checks it too; this is the check that counts. Never logged or echoed.
  const form = await request.formData().catch(() => null);
  const passphrase = form?.get("passphrase");
  if (typeof passphrase !== "string" || passphraseProblem(passphrase) || form?.get("passphraseAgain") !== passphrase) {
    return NextResponse.redirect(new URL("/data?stepup=passphrase#backups", request.url), 303);
  }

  const backup = await buildBackup(viewer.householdId, new Date(), { sealMoney, takenBy: viewer.id });
  const text = await lockBackup(JSON.stringify(backup, null, 2), passphrase);
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
  return downloadResponse(text, `familyos-backup-${exportDateStamp()}-locked.json`, "application/json; charset=utf-8");
}
