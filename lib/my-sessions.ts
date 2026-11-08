import { prisma } from "@/lib/prisma";
import { deviceLabel } from "@/lib/device-label";
import { recordSignInEvent } from "@/lib/sign-in-events";

/**
 * Phase 67a: your own sign-in's devices (Settings → Where I'm signed in). Sessions are never
 * refreshed (lib/auth.ts disableSessionRefresh), so each row is where and when it signed in.
 * Signing one out deletes its session row, which counts at that device's next request (the
 * session cookie cache stays off). Only ever the signed-in user's own rows, and never the session
 * doing the asking: "everywhere else" leaves this device signed in.
 */

export type MySession = { id: string; device: string; signedInAt: Date; current: boolean };

export async function listMySessions(userId: string, currentId: string, now: Date = new Date()): Promise<MySession[]> {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, userAgent: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const sessions = rows.map((r) => ({ id: r.id, device: deviceLabel(r.userAgent), signedInAt: r.createdAt, current: r.id === currentId }));
  // This device first.
  return [...sessions.filter((s) => s.current), ...sessions.filter((s) => !s.current)];
}

type Me = { userId: string; currentSessionId: string; person: { id: string; firstName: string; householdId: string } };

/** Signs out one of your other devices. False when it's gone already, someone else's, or this one. */
export async function signOutMySession(me: Me, sessionId: string): Promise<boolean> {
  if (sessionId === me.currentSessionId) return false;
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { id: sessionId, userId: me.userId } });
    if (count) await recordSignInEvent(tx, { householdId: me.person.householdId, kind: "SIGNED_OUT_ELSEWHERE", actor: me.person, subject: me.person, detail: "one device" });
    return count > 0;
  });
}

/** Signs out every device but this one. Returns how many went. */
export async function signOutMyOtherSessions(me: Me): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { userId: me.userId, id: { not: me.currentSessionId }, expiresAt: { gt: new Date() } } });
    if (count) await recordSignInEvent(tx, { householdId: me.person.householdId, kind: "SIGNED_OUT_ELSEWHERE", actor: me.person, subject: me.person, detail: "everywhere else" });
    return count;
  });
}
