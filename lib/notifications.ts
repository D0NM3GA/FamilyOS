import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { NotificationKind } from "@/app/generated/prisma/enums";
import { offLinkPrefixes } from "@/lib/apps";

/**
 * Phase 20: the in-app bell's inbox. A kernel (no domain imports) so the Sticker Store
 * today, and other domains later, can ping people. Phase 21 adds delivery channels (phone
 * push, Teams, email) on top of this same record.
 */

type Tx = Prisma.TransactionClient;

/**
 * Pings every household ADMIN except the person who caused it (owner's call: alerts go to
 * the admins). An admin acting on their own sees it in "Orders to make happen" instead, so
 * a household with one admin who placed the order simply gets no ping.
 */
export async function notifyAdmins(
  tx: Tx,
  householdId: string,
  exceptPersonId: string,
  n: { kind: NotificationKind; title: string; href: string; orderId?: string },
) {
  const admins = await tx.person.findMany({
    where: { householdId, isHouseholdMember: true, role: "ADMIN", id: { not: exceptPersonId } },
    select: { id: true },
  });
  if (admins.length === 0) return 0;
  await tx.notification.createMany({
    data: admins.map((a) => ({ householdId, recipientId: a.id, ...n })),
  });
  return admins.length;
}

/** Pings one person (Phase 23: a kid whose grocery pick was "not this time"). */
export async function notifyPerson(
  tx: Tx | typeof prisma,
  n: { householdId: string; recipientId: string; kind: NotificationKind; title: string; href: string },
) {
  await tx.notification.create({ data: n });
}

/**
 * Phase 36: one person's notifications, minus those that link into an app the family turned
 * off (lib/apps.ts offLinkPrefixes, isLinkOn's rule). Hidden, not deleted, not marked read:
 * they're back, as they were, with the app.
 */
function visibleTo(personId: string, disabledApps: readonly string[]): Prisma.NotificationWhereInput {
  const { exact, startsWith } = offLinkPrefixes(disabledApps);
  if (exact.length === 0) return { recipientId: personId };
  return {
    recipientId: personId,
    NOT: { OR: [{ href: { in: exact } }, ...startsWith.map((p) => ({ href: { startsWith: p } }))] },
  };
}

/** Cheap enough for the layout: one indexed count. */
export function unreadCount(personId: string, disabledApps: readonly string[] = []): Promise<number> {
  return prisma.notification.count({ where: { ...visibleTo(personId, disabledApps), readAt: null } });
}

/** The bell's list, newest first, narrowed to what the client needs. */
export async function recentNotifications(personId: string, take = 10, disabledApps: readonly string[] = []) {
  const rows = await prisma.notification.findMany({
    where: visibleTo(personId, disabledApps),
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, href: true, readAt: true, createdAt: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, href: r.href, unread: r.readAt === null, createdAt: r.createdAt }));
}

export async function markAllRead(personId: string, disabledApps: readonly string[] = []) {
  await prisma.notification.updateMany({ where: { ...visibleTo(personId, disabledApps), readAt: null }, data: { readAt: new Date() } });
}
