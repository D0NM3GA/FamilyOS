import { prisma } from "@/lib/prisma";

/**
 * Phase 61: tidying tables that otherwise only grow, on the background tick. Only what nobody
 * reads any more: sign-in sessions expired more than a day ago (a session past its expiry is
 * refused anyway; the day leaves Better Auth's own checks room), and notifications read more
 * than 90 days ago (the page shows the latest 100). Left alone on purpose: sign-in events
 * (append-only, lib/sign-in-events.ts), rate-limit rows (Better Auth prunes them), sign-in
 * challenges and invites (lib/setup.ts, lib/invites.ts purge those), and change history.
 */

export const SESSION_GRACE_MS = 24 * 60 * 60_000;
export const READ_NOTIFICATION_DAYS = 90;
const BATCH = 1000;
/** At most this many batches per table per tick: a backlog clears over a few ticks, never in one long one. */
const MAX_BATCHES = 20;

export function cutoffs(now: Date = new Date()) {
  return {
    sessionsExpiredBefore: new Date(now.getTime() - SESSION_GRACE_MS),
    notificationsReadBefore: new Date(now.getTime() - READ_NOTIFICATION_DAYS * 24 * 60 * 60_000),
  };
}

async function inBatches(find: () => Promise<{ id: string }[]>, remove: (ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const ids = (await find()).map((r) => r.id);
    if (ids.length === 0) break;
    total += (await remove(ids)).count;
    if (ids.length < BATCH) break;
  }
  return total;
}

export async function runCleanup(now: Date = new Date()): Promise<{ sessions: number; notifications: number }> {
  const c = cutoffs(now);
  const sessions = await inBatches(
    () => prisma.session.findMany({ where: { expiresAt: { lt: c.sessionsExpiredBefore } }, select: { id: true }, take: BATCH }),
    (ids) => prisma.session.deleteMany({ where: { id: { in: ids }, expiresAt: { lt: c.sessionsExpiredBefore } } }),
  );
  const notifications = await inBatches(
    () => prisma.notification.findMany({ where: { readAt: { lt: c.notificationsReadBefore } }, select: { id: true }, take: BATCH }),
    (ids) => prisma.notification.deleteMany({ where: { id: { in: ids }, readAt: { lt: c.notificationsReadBefore } } }),
  );
  return { sessions, notifications };
}
