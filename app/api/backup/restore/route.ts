import { createHash } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { BACKUP_CARD, recordBackupEvent } from "@/lib/backup/audit";
import { deliverNotifications } from "@/lib/alerts/dispatch";
import { holdMoneySyncs, previewMoney, restoreMoney, sealMoney } from "@/lib/finance/backup";
import { parseBackupFile } from "@/lib/backup/plan";
import { applyRestore, previewRestore } from "@/lib/backup/restore";
import { authorizeRestore, MAX_RESTORE_BYTES, restoreJson as json } from "@/lib/backup/restore-request";
import { captureError, setSentryUser } from "@/lib/observability";

/**
 * POST /api/backup/restore?mode=preview|apply (Phase 16.5). The body is the backup file
 * itself (application/json). Two stateless calls: preview (no writes) returns a summary,
 * the file's hash and a digest of the people plan; apply must send both back plus the typed
 * confirmation, so what the admin confirmed is exactly what's applied. Nothing is stored
 * between the two. Guards: lib/backup/restore-request.ts. Responses never echo file
 * content (see lib/backup/plan.ts).
 *
 * Phase 28: the admin must have signed in within 15 minutes; a restore is recorded (the
 * applied file's hash, and the hash of "the household as it was" exactly as the browser
 * saves it) after it commits, since restore clears the bell's notifications. The snapshot
 * seals today's money jars. Phase 28.5: `money=1` on apply also puts the file's sealed jars
 * back (lib/finance/backup.ts), after holding every bank sync off for the duration.
 */
export async function POST(request: Request) {
  const auth = await authorizeRestore(request);
  if ("response" in auth) return auth.response;
  const { viewer } = auth;
  setSentryUser(viewer.id);

  const text = await request.text();
  if (text.length > MAX_RESTORE_BYTES) return json({ errors: ["That file is too large to be a household backup."] }, 413);

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const fileHash = createHash("sha256").update(text).digest("hex");

  const parsed = parseBackupFile(text);
  if (!parsed.ok) return json({ errors: parsed.errors }, 400);

  try {
    if (mode === "preview") {
      const result = await previewRestore(viewer.householdId, parsed.backup, { previewMoney });
      if (!result.ok) return json({ errors: result.errors }, 400);
      return json({ preview: result.preview, fileHash });
    }

    if (mode === "apply") {
      if (url.searchParams.get("hash") !== fileHash) {
        return json({ errors: ["This isn't the file you previewed. Preview it again."] }, 409);
      }
      if (url.searchParams.get("confirm") !== "REPLACE") {
        return json({ errors: ["Type REPLACE to confirm."] }, 400);
      }
      const withMoney = url.searchParams.get("money") === "1";
      const hold = withMoney ? await holdMoneySyncs(viewer.householdId) : null;
      if (withMoney && !hold) return json({ errors: ["A bank sync is running right now. Try again in a minute."] }, 409);
      const result = await applyRestore(viewer.householdId, viewer.id, parsed.backup, {
        allowTimeZoneMismatch: url.searchParams.get("allowTimeZoneMismatch") === "1",
        expectedPlanDigest: url.searchParams.get("plan") ?? "",
        hooks: { sealMoney, restoreMoney },
        restoreMoney: withMoney,
      }).catch(async (err: unknown) => {
        await hold?.release();
        throw err;
      });
      if (!result.ok) {
        await hold?.release();
        return json({ errors: result.errors }, 400);
      }
      revalidatePath("/", "layout");
      // The restore has committed: from here nothing may stop the snapshot reaching the
      // browser, so a failed record is reported, not returned.
      try {
        const { notificationIds } = await recordBackupEvent({
          householdId: viewer.householdId,
          actorId: viewer.id,
          actorName: viewer.firstName,
          kind: "HOUSEHOLD_RESTORE",
          // includesMoney/jarCount describe the snapshot handed back (its sealed jars).
          includesMoney: result.previousBackup.sealedMoney != null,
          jarCount: result.previousBackup.sealedMoney?.jarCount ?? 0,
          moneyRestored: result.money != null,
          restoredJarCount: result.money?.restored.jars ?? 0,
          previousJarMemberIds: result.money?.previousMemberIds ?? [],
          fileText: text,
          // restore-form.tsx saves it with this same serialization.
          snapshotText: JSON.stringify(result.previousBackup, null, 2),
        });
        after(() => deliverNotifications({ id: { in: notificationIds } }, { channels: "teams-first", card: BACKUP_CARD }));
      } catch (err) {
        captureError(err);
      }
      return json({ previousBackup: result.previousBackup, inserted: result.inserted, moneyRestored: result.money?.restored ?? null });
    }

    return json({ errors: ["Unknown mode."] }, 400);
  } catch (err) {
    // Scrubbed by lib/observability; the response itself is generic. Restore runs in one
    // transaction, so a throw here means it rolled back.
    captureError(err);
    return json({ errors: ["The restore failed and was rolled back, so the data should be unchanged. Check before trying again."] }, 500);
  }
}
