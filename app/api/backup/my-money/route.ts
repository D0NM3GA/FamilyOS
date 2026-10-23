import { after } from "next/server";
import { NextResponse } from "next/server";
import { BACKUP_CARD, recordBackupEvent } from "@/lib/backup/audit";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import { moneyViewer } from "@/lib/finance/access";
import { buildMyMoneyBackup } from "@/lib/finance/backup";
import { todayCivil } from "@/lib/finance/budget";
import { authorizeExport, downloadResponse, exportDateStamp } from "@/lib/export";

/**
 * Phase 28: a person's own copy of their money jars (lib/finance/backup.ts), readable, only
 * what they can see in the app. POST from /finances, by the person themselves, signed in
 * within 15 minutes. Recorded and announced to that same person.
 */
export async function POST(request: Request) {
  const auth = await authorizeExport(request, "adult", { stepUpPath: "/finances" });
  if (auth.response) return auth.response;
  const viewer = await moneyViewer();
  if (!viewer) return new NextResponse(null, { status: 403 });

  const backup = await buildMyMoneyBackup(viewer.id, viewer.householdId, todayCivil());
  const text = JSON.stringify(backup, null, 2);
  const { notificationIds } = await recordBackupEvent({
    householdId: viewer.householdId,
    actorId: viewer.id,
    actorName: viewer.firstName,
    kind: "MONEY_BACKUP",
    includesMoney: true,
    jarCount: backup.jars.length,
    fileText: text,
  });
  after(() => deliverNotifications({ id: { in: notificationIds } }, { channels: "teams-first", card: BACKUP_CARD }));
  return downloadResponse(text, `familyos-my-money-${exportDateStamp()}.json`, "application/json; charset=utf-8");
}
