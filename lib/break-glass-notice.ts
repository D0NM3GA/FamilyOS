import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { readBreakGlass } from "@/lib/security/break-glass";
import { recordSignInEvent } from "@/lib/sign-in-events";

/**
 * Phase 42.7: the break-glass entrance is loud. The app shell asks this on every page: while the
 * entrance is on it returns when it ends (for the banner), and the first time it sees a new
 * activation it tells every admin (the bell, then Teams or their phone, like a sign-in change);
 * once an activation is over, it tells them that too. Each happens once: the activation's id is
 * a row in BreakGlassNotice, so concurrent pages can't double up. It's also in the sign-in log.
 * Writes during a page render: fine on this long-running Node server, never for a serverless one.
 */
export async function breakGlassStatus(householdId: string, timeZone: string | null, now = Date.now()): Promise<{ endsAt: Date } | null> {
  // The entrance only means something with Cloudflare Access on (proxy.ts); skip the reads otherwise.
  if (!process.env.CF_ACCESS_TEAM_DOMAIN?.trim() && !process.env.BREAK_GLASS_STATE) return null;
  const state = await readBreakGlass(now);
  const toDeliver: string[] = [];

  if (state) {
    try {
      await prisma.breakGlassNotice.create({ data: { id: state.id, householdId, startedAt: state.startedAt, endsAt: state.endsAt } });
      await recordSignInEvent(prisma, { householdId, kind: "BREAK_GLASS_ON", actor: SERVER, subject: SERVER, detail: time(state.endsAt, timeZone) });
      toDeliver.push(...(await tellAdmins(householdId, `Emergency local access was turned on on the server, until ${time(state.endsAt, timeZone)}. If that wasn't someone in the family, check the server now.`)));
    } catch (err) {
      // Already noted: another page got there first, or an earlier one.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  // Activations that have ended (switched off or run out) and haven't been reported as ended.
  const ended = await prisma.breakGlassNotice.findMany({
    where: { householdId, endedAt: null, ...(state ? { id: { not: state.id } } : {}) },
    select: { id: true },
  });
  for (const { id } of ended) {
    const { count } = await prisma.breakGlassNotice.updateMany({ where: { id, endedAt: null }, data: { endedAt: new Date(now) } });
    if (count) {
      await recordSignInEvent(prisma, { householdId, kind: "BREAK_GLASS_OFF", actor: SERVER, subject: SERVER });
      toDeliver.push(...(await tellAdmins(householdId, "Emergency local access is off again.")));
    }
  }

  if (toDeliver.length) {
    const { deliverNotifications } = await import("@/lib/alerts/dispatch");
    const { SIGN_IN_CARD } = await import("@/lib/sign-in-notices");
    void deliverNotifications({ id: { in: toDeliver } }, { channels: "teams-first", card: SIGN_IN_CARD });
  }
  return state ? { endsAt: state.endsAt } : null;
}

async function tellAdmins(householdId: string, title: string): Promise<string[]> {
  const admins = await prisma.person.findMany({ where: { householdId, isHouseholdMember: true, role: "ADMIN" }, select: { id: true } });
  const made = await prisma.notification.createManyAndReturn({
    data: admins.map((a) => ({ householdId, recipientId: a.id, kind: "SIGN_IN_CHANGED" as const, title, href: "/settings/sign-in" })),
    select: { id: true },
  });
  return made.map((n) => n.id);
}

/** The server switched it, not a person: the audit log names it so. */
const SERVER = { id: null, firstName: "The server" };

/** In the household's own time zone, not the server's. */
export function breakGlassTime(d: Date, timeZone: string | null): string {
  try {
    return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timeZone ?? undefined });
  } catch {
    return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
}
const time = breakGlassTime;
