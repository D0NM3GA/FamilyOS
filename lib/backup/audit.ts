import { createHash } from "node:crypto";
import type { BackupKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { TeamsCard } from "@/lib/alerts/teams";

/**
 * Phase 28: the accounting in AAA. Every backup handed out and every restore applied gets a
 * BackupEvent, written before the file leaves the server, and the people it concerns are
 * told (the bell, then Teams through lib/alerts, which the route runs after the response).
 *
 * Who is told:
 * - a household backup or restore: the other admins, and everyone in a money jar (their
 *   jars are in the file, sealed), current family adults with their own sign-in
 *   only (Teams can't reach anyone else);
 * - a person's own money backup: that person, so a copy they didn't make doesn't go unseen,
 *   and the other members of their jars (owner's call, 2026-10-08: a shared jar's copy is the
 *   jar-mates' business too), never anyone outside those jars, admins included.
 * Messages never name a jar (jar names are members-only).
 *
 * The one money read in lib/backup: jar membership, straight from Prisma (lib/backup may not
 * import lib/finance).
 */

export const BACKUP_CARD: TeamsCard = { heading: "🗄️ Backups", linkText: "See backup history" };

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type BackupEventInput = {
  householdId: string;
  actorId: string;
  actorName: string;
  kind: BackupKind;
  includesMoney: boolean;
  jarCount: number;
  /** The exact text the browser saves (or, for a restore, the uploaded file). */
  fileText: string;
  /** A restore: "the household as it was", as the browser saves it. */
  snapshotText?: string;
  /** Phase 28.5: a restore that put the file's money jars back, and who was in a jar before. */
  moneyRestored?: boolean;
  restoredJarCount?: number;
  previousJarMemberIds?: string[];
};

export function backupMessage(i: Pick<BackupEventInput, "kind" | "actorName" | "includesMoney" | "moneyRestored">, toJarMate = false): string {
  if (i.kind === "MONEY_BACKUP" && toJarMate) return `🗄️ ${i.actorName} downloaded a copy of a money jar you share.`;
  if (i.kind === "MONEY_BACKUP") return "🗄️ A copy of your money jars was just downloaded. If that wasn't you, tell an admin.";
  if (i.kind === "HOUSEHOLD_RESTORE" && i.moneyRestored) {
    return `♻️ ${i.actorName} restored the household and its money jars from a backup. Bank feeds need reconnecting in each jar's Settings.`;
  }
  if (i.kind === "HOUSEHOLD_RESTORE") {
    return `♻️ ${i.actorName} restored the household from a backup. Money jars weren't changed${i.includesMoney ? "; a sealed copy of them went with the saved copy of the old household" : ""}.`;
  }
  return `🗄️ ${i.actorName} downloaded a household backup.${i.includesMoney ? " Money jars are in it, sealed: only this server can open them." : ""}`;
}

const linkedAdult = { isHouseholdMember: true, authUserId: { not: null }, role: { in: ["ADULT" as const, "ADMIN" as const] } };

async function recipients(i: BackupEventInput): Promise<string[]> {
  if (i.kind === "MONEY_BACKUP") {
    // The copy holds every jar the person is in; their jar-mates (signed in as themselves).
    const mates = await prisma.moneyJarMember.findMany({
      where: { jar: { householdId: i.householdId, members: { some: { personId: i.actorId } } }, person: { householdId: i.householdId, ...linkedAdult } },
      select: { personId: true },
    });
    return [i.actorId, ...new Set(mates.map((m) => m.personId).filter((id) => id !== i.actorId))];
  }
  const withMoney = i.includesMoney || Boolean(i.moneyRestored);
  const [admins, jarMembers] = await Promise.all([
    prisma.person.findMany({ where: { householdId: i.householdId, ...linkedAdult, role: "ADMIN" }, select: { id: true } }),
    withMoney
      ? prisma.moneyJarMember.findMany({ where: { jar: { householdId: i.householdId }, person: { householdId: i.householdId, ...linkedAdult } }, select: { personId: true } })
      : Promise.resolve([]),
  ]);
  // Phase 28.5: people whose jars a restore just replaced are told too (if still here and signed in).
  const previous = i.previousJarMemberIds?.length
    ? await prisma.person.findMany({ where: { id: { in: i.previousJarMemberIds }, householdId: i.householdId, ...linkedAdult }, select: { id: true } })
    : [];
  return [...new Set([...admins.map((a) => a.id), ...jarMembers.map((m) => m.personId), ...previous.map((p) => p.id)])].filter((id) => id !== i.actorId);
}

/** A repeat within this long (a double click, a curious admin) is recorded but not re-announced. */
const QUIET_REPEAT_MS = 5 * 60_000;

/** Records the event and the bell notifications together; returns the notification ids to deliver. */
export async function recordBackupEvent(i: BackupEventInput, now: Date = new Date()): Promise<{ eventId: string; notificationIds: string[] }> {
  const repeat = await prisma.backupEvent.count({
    where: { householdId: i.householdId, actorId: i.actorId, kind: i.kind, createdAt: { gt: new Date(now.getTime() - QUIET_REPEAT_MS) } },
  });
  const notified = repeat ? [] : await recipients(i);
  const title = backupMessage(i);
  return prisma.$transaction(async (tx) => {
    const event = await tx.backupEvent.create({
      data: {
        householdId: i.householdId,
        actorId: i.actorId,
        kind: i.kind,
        includesMoney: i.includesMoney,
        jarCount: i.jarCount,
        fileSha256: sha256(i.fileText),
        bytes: Buffer.byteLength(i.fileText, "utf8"),
        snapshotSha256: i.snapshotText != null ? sha256(i.snapshotText) : null,
        moneyRestored: Boolean(i.moneyRestored),
        restoredJarCount: i.restoredJarCount ?? 0,
        notifiedIds: notified,
      },
      select: { id: true },
    });
    const notificationIds: string[] = [];
    for (const recipientId of notified) {
      const n = await tx.notification.create({
        data: {
          householdId: i.householdId,
          recipientId,
          kind: i.kind === "HOUSEHOLD_RESTORE" ? "BACKUP_RESTORED" : "BACKUP_MADE",
          title: i.kind === "MONEY_BACKUP" && recipientId !== i.actorId ? backupMessage(i, true) : title,
          href: "/data#history",
        },
        select: { id: true },
      });
      notificationIds.push(n.id);
    }
    return { eventId: event.id, notificationIds };
  });
}

/**
 * /data "Backup history": admins see every household backup and restore; anyone else, what
 * they did or were told about. Someone's own money-jar copy is listed only for them and their
 * jar-mates (who were told), not for other admins, or the list would tell an admin that (say)
 * Grandma has a jar.
 */
export function backupHistory(viewer: { id: string; householdId: string; role: string | null }, take = 20) {
  const mine = [{ actorId: viewer.id }, { notifiedIds: { has: viewer.id } }];
  return prisma.backupEvent.findMany({
    where: { householdId: viewer.householdId, OR: viewer.role === "ADMIN" ? [{ kind: { not: "MONEY_BACKUP" } }, ...mine] : mine },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, includesMoney: true, jarCount: true, moneyRestored: true, restoredJarCount: true, fileSha256: true, bytes: true, createdAt: true, actorId: true, actor: { select: { firstName: true } } },
  });
}
