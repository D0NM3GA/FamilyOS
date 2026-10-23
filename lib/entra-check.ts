import { prisma } from "@/lib/prisma";
import { recordSignInEvent } from "@/lib/sign-in-events";
import { deliverSignInNotices, writeSignInNotices, type Announced } from "@/lib/sign-in-notices";
import { microsoftConfigFrom } from "@/lib/microsoft-config";
import { captureError } from "@/lib/observability";
import { workingAdmins } from "@/lib/sign-ins";
import { EntraGraphError, readEntraAssignments, type EntraRole } from "@/lib/entra-graph";
import { decodeIdTokenClaims, ENTRA, mapEntraRoleClaim } from "@/lib/entra-claims";

/**
 * Phase 40.4: who Entra assigns to the app, checked against the household on a schedule (the
 * background tick) and on demand ("Check now" in Settings → Sign-in): the owner's call, instead
 * of SCIM, since the app isn't reachable from the internet. Entra is the source of truth for
 * Microsoft-linked people (Phase 38's call). For each of them:
 *
 * - assigned, with a role that differs from the stored one → the role follows Entra, unless the
 *   ID token from their latest sign-in says otherwise and is newer than the last good check
 *   (Entra's directory can lag its own sign-ins; this keeps the two from taking turns);
 * - not assigned (or only as Kid) → access ended on the first check that says so (the owner's
 *   call, 2026-10-14): `entraAccessEndedAt` is set, their sessions go, invites and reset links
 *   they made go, and they're told (bell, email, Teams) along with the other admins. They stay
 *   linked: a sign-in with an Admin/Adult role again restores them (lib/active-profile.ts).
 *
 * Fail safe: an incomplete read of Entra, a missing permission, or an empty answer changes
 * nothing; and a run that would leave no admin who can sign in is refused whole. One run at a
 * time (a lease on the status row; Graph is read outside any transaction), applied in one
 * transaction that re-reads the people it changes.
 */

export { ENTRA };
const LEASE_MS = 2 * 60_000;
/** The background tick runs every 30 minutes; a run this recent is left alone. */
export const ENTRA_CHECK_EVERY_MS = 25 * 60_000;
const CHECK_NOW_GAP_MS = 60_000;

export type EntraOutcome = "ok" | "permission" | "config" | "unavailable" | "unexpected" | "empty" | "noAdmin" | "busy";

/** Fixed words for each outcome (Settings → Sign-in). */
export const ENTRA_OUTCOME_WORDS: Record<Exclude<EntraOutcome, "busy">, string> = {
  ok: "Checked with Entra",
  permission: "Can't check Entra: the app needs the Application.Read.All and GroupMember.ReadBasic.All application permissions, with admin consent",
  config: "Can't check Entra: the app's Microsoft settings (MICROSOFT_CLIENT_ID and its secret) didn't work",
  unavailable: "Couldn't reach Entra on the last check",
  unexpected: "Entra's answer on the last check didn't make sense, so nothing was changed",
  empty: "Entra says nobody is assigned to the app, so nothing was changed",
  noAdmin: "The last check would have left no admin who can sign in, so nothing was changed",
};

export type EntraRunResult = { outcome: EntraOutcome; changed: number; ended: number; notices: Announced[] };

/** Claims the household's lease; false when a run is already going. */
async function claimLease(householdId: string, now: Date): Promise<boolean> {
  await prisma.entraCheck.upsert({ where: { householdId }, create: { householdId }, update: {} });
  const { count } = await prisma.entraCheck.updateMany({
    where: { householdId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return count === 1;
}

async function release(householdId: string, now: Date, outcome: EntraOutcome): Promise<void> {
  await prisma.entraCheck.update({
    where: { householdId },
    data: { leaseUntil: null, lastRunAt: now, outcome, ...(outcome === "ok" ? { lastOkAt: now } : {}) },
  });
}

/** Seconds since the epoch the stored ID token was issued, and its role, or nulls. */
function tokenFacts(idToken: string | null): { role: EntraRole | null; issuedAt: number | null } {
  const claims = idToken ? decodeIdTokenClaims(idToken) : null;
  return { role: mapEntraRoleClaim(claims?.roles), issuedAt: typeof claims?.iat === "number" ? claims.iat : null };
}

const roleLabel = (role: EntraRole) => (role === "ADMIN" ? "Admin" : "Adult");

class Refused extends Error {
  constructor(readonly outcome: EntraOutcome) {
    super(outcome);
  }
}

/**
 * One check for a household. `readAssignments` is injectable for the tests. Never throws for
 * Entra's sake; the outcome says what happened.
 */
export async function runEntraCheck(
  householdId: string,
  { readAssignments = readEntraAssignments, now = new Date() }: { readAssignments?: () => Promise<Map<string, EntraRole>>; now?: Date } = {},
): Promise<EntraRunResult> {
  const none = (outcome: EntraOutcome): EntraRunResult => ({ outcome, changed: 0, ended: 0, notices: [] });
  if (!(await claimLease(householdId, now))) return none("busy");

  let assigned: Map<string, EntraRole>;
  try {
    assigned = await readAssignments();
  } catch (e) {
    const outcome = e instanceof EntraGraphError ? e.code : "unexpected";
    await release(householdId, now, outcome);
    return none(outcome);
  }
  if (assigned.size === 0) {
    await release(householdId, now, "empty");
    return none("empty");
  }

  const lastOkAt = (await prisma.entraCheck.findUnique({ where: { householdId }, select: { lastOkAt: true } }))?.lastOkAt ?? null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // The same lock as an admin's changes (lib/sign-ins.ts), so the last-admin rule holds across
      // both, and a second run whose lease ran out waits and finds the work done.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"signins:" + householdId}))`;
      const linked = await tx.person.findMany({
        where: { householdId, isHouseholdMember: true, authUserId: { not: null }, authUser: { is: { accounts: { some: { providerId: "microsoft" } } } } },
        select: {
          id: true,
          firstName: true,
          role: true,
          authUserId: true,
          entraAccessEndedAt: true,
          authUser: { select: { accounts: { where: { providerId: "microsoft" }, orderBy: { updatedAt: "desc" }, select: { accountId: true, idToken: true } } } },
        },
      });
      let changed = 0;
      let ended = 0;
      const notices: Announced[] = [];
      for (const p of linked) {
        const account = p.authUser?.accounts[0];
        if (!account || !p.authUserId) continue;
        const entraRole = assigned.get(account.accountId.toLowerCase());
        const subject = { id: p.id, firstName: p.firstName };

        if (!entraRole) {
          if (p.entraAccessEndedAt) continue;
          await tx.person.update({ where: { id: p.id }, data: { entraAccessEndedAt: now } });
          await tx.session.deleteMany({ where: { userId: p.authUserId } });
          await tx.invite.deleteMany({ where: { createdById: p.id } });
          await recordSignInEvent(tx, { householdId, kind: "ENTRA_ACCESS_ENDED", actor: ENTRA, subject });
          notices.push(await writeSignInNotices(tx, { householdId, kind: "ENTRA_ACCESS_ENDED", actor: ENTRA, subject }));
          ended++;
          continue;
        }

        // Someone Entra cut off comes back by signing in, not here (and hears nothing till then).
        if (p.entraAccessEndedAt) continue;
        if (entraRole !== p.role) {
          // The two sources disagree: Entra's latest sign-in wins until a check sees past it.
          const token = tokenFacts(account.idToken);
          const tokenIsNewer = token.issuedAt !== null && lastOkAt !== null && token.issuedAt * 1000 > lastOkAt.getTime();
          if (token.role !== null && token.role !== entraRole && tokenIsNewer) continue;
          await tx.person.update({ where: { id: p.id }, data: { role: entraRole } });
          await recordSignInEvent(tx, { householdId, kind: "ROLE_CHANGED", actor: ENTRA, subject, detail: roleLabel(entraRole) });
          notices.push(await writeSignInNotices(tx, { householdId, kind: "ROLE_CHANGED", actor: ENTRA, subject, role: roleLabel(entraRole) }));
          changed++;
        }
      }
      if ((changed || ended) && (await workingAdmins(tx, householdId)) === 0) throw new Refused("noAdmin");
      return { changed, ended, notices };
    });
    await release(householdId, now, "ok");
    return { outcome: "ok", ...result };
  } catch (e) {
    if (!(e instanceof Refused)) {
      await release(householdId, now, "unexpected").catch(() => {});
      throw e;
    }
    await release(householdId, now, e.outcome);
    return none(e.outcome);
  }
}

/** The background tick: when Microsoft is on and the last run is old enough. */
export async function entraCheckDue(householdId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.entraCheck.findUnique({ where: { householdId }, select: { lastRunAt: true } });
  return !row?.lastRunAt || now.getTime() - row.lastRunAt.getTime() >= ENTRA_CHECK_EVERY_MS;
}

/** "Check now": not again within a minute of the last run. */
export async function entraCheckNowAllowed(householdId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.entraCheck.findUnique({ where: { householdId }, select: { lastRunAt: true } });
  return !row?.lastRunAt || now.getTime() - row.lastRunAt.getTime() >= CHECK_NOW_GAP_MS;
}

/** Settings → Sign-in's status: when the last run was and how it went. */
export function entraCheckStatus(householdId: string) {
  return prisma.entraCheck.findUnique({ where: { householdId }, select: { lastRunAt: true, outcome: true } });
}

/** Delivers a run's notices (after it has committed). */
export async function announceEntraCheck(result: EntraRunResult): Promise<void> {
  for (const notices of result.notices) await deliverSignInNotices(notices);
}

/**
 * The background tick (lib/background.ts): every half hour while Microsoft is on. Its own errors
 * are reported and stay its own, so the rest of the tick still runs.
 */
export async function runScheduledEntraCheck(now: Date = new Date()): Promise<void> {
  if (microsoftConfigFrom(process.env) === null) return;
  try {
    const household = await prisma.household.findFirst({ select: { id: true } });
    if (!household || !(await entraCheckDue(household.id, now))) return;
    const result = await runEntraCheck(household.id, { now });
    // Counts only: never who, nor anything Entra said.
    if (result.outcome !== "ok") console.warn(`[entra] check: ${result.outcome}`);
    else if (result.changed || result.ended) console.info(`[entra] check: ${result.changed} role(s) changed, ${result.ended} ended`);
    await announceEntraCheck(result);
  } catch {
    captureError(new Error("Entra check failed"));
  }
}
