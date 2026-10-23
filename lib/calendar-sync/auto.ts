import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGraphToken, graphWithToken } from "@/lib/graph/client";
import { captureError } from "@/lib/observability";
import { autoSyncDue, claimLease, runSync } from "./run";
import { cleanDisabledApps, isAppOn } from "@/lib/apps";

// Phase 29: moved to lib/graph/client.ts so other domains can use it; re-exported here.
export { graphWithToken };

/**
 * Home's automatic sync (Phase 17). Only for the calendar's owner, on their own signed-in
 * profile, since the run writes with their Microsoft token; at most every 30 minutes;
 * never while Outlook has asked the app to back off. The run happens after the page is
 * sent (after()), so it never slows Home. The lease is claimed here, before scheduling,
 * so two renders at once can't both start one, and the token is fetched here too:
 * a Server Component can't read request headers inside after().
 */
export async function scheduleAutoSync(profile: { id: string; householdId: string; authUserId: string | null }): Promise<void> {
  if (!profile.authUserId) return;
  const sync = await prisma.calendarSync.findUnique({
    where: { householdId: profile.householdId },
    select: {
      id: true,
      ownerPersonId: true,
      lastSyncedAt: true,
      retryAfterUntil: true,
      leaseUntil: true,
      optionsChangedAt: true,
      household: { select: { disabledApps: true } },
    },
  });
  if (!sync || sync.ownerPersonId !== profile.id || !autoSyncDue(sync)) return;
  // Phase 36: paused while the family has Calendar turned off (runSync checks again).
  if (!isAppOn(cleanDisabledApps(sync.household.disabledApps), "calendar")) return;
  // better-auth only refreshes a token in its last seconds, so one about to expire would
  // fail partway through the run. Wait for a visit with a fresh one.
  const account = await prisma.account.findFirst({
    where: { userId: profile.authUserId, providerId: "microsoft" },
    select: { accessTokenExpiresAt: true },
  });
  // Phase 40.1b: no Microsoft account (a passkey sign-in), nothing to sync with.
  if (!account) return;
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60_000) return;
  if (!(await claimLease(sync.id))) return;

  let token: string;
  try {
    token = await getGraphToken();
  } catch {
    // Not signed in with a usable Microsoft token right now; try again on a later visit.
    await prisma.calendarSync.updateMany({ where: { id: sync.id }, data: { leaseUntil: null } });
    return;
  }

  after(async () => {
    try {
      await runSync({ syncId: sync.id, graph: graphWithToken(token), leaseHeld: true });
    } catch (err) {
      captureError(err);
      await prisma.calendarSync.updateMany({ where: { id: sync.id }, data: { leaseUntil: null } }).catch(() => {});
    }
  });
}
