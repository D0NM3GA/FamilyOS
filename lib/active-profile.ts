import { createHmac, timingSafeEqual } from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerSession, signedInRecently } from "@/lib/session";
import { devAuthPerson, isDevUser } from "@/lib/dev-auth";
import { setSentryUser } from "@/lib/observability";
import { microsoftConfigFrom } from "@/lib/microsoft-config";
import { OIDC_PROVIDER_ID, oidcConfigFrom } from "@/lib/oidc-config";
import { oidcPreflightFailed } from "@/lib/oidc-preflight";
import { isSetUp } from "@/lib/setup";
import { decodeIdTokenClaims, ENTRA, mapEntraRoleClaim } from "@/lib/entra-claims";
import { recordSignInEvent } from "@/lib/sign-in-events";

const COOKIE_NAME = "active_profile";

/**
 * The cookie's own key, derived from BETTER_AUTH_SECRET (not the secret itself, so the two
 * uses never share a key). Fails closed: with no secret the cookie would be signed with an
 * empty key and anyone could forge one for any profile.
 */
function cookieKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set; the active-profile cookie can't be signed.");
  return createHmac("sha256", secret).update("familyos-active-profile-v2").digest();
}

/**
 * Signs the profile together with the Better Auth session it was picked in, so the cookie
 * means nothing after sign-out or to the next person who signs in on the same browser.
 */
function sign(personId: string, sessionId: string) {
  return createHmac("sha256", cookieKey()).update(`${personId}:${sessionId}`).digest("hex");
}

/** Sets the tamper-evident "who's using the app right now" cookie, for this sign-in only. */
export async function setActiveProfileCookie(personId: string) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  const store = await cookies();
  store.set(COOKIE_NAME, `${personId}.${sign(personId, session.session.id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

async function readActiveProfileId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const [personId, signature] = raw.split(".");
  if (!personId || !signature) return null;
  const session = await getServerSession();
  if (!session) return null;

  const expected = sign(personId, session.session.id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return personId;
}

/**
 * Phase 40.4: what a sign-in's Microsoft account says, in three states: no Microsoft account at
 * all (passkey or OIDC people: Entra has no say), or one whose current ID token gives Admin,
 * Adult, or nothing (no claim, Kid only, or a token that can't be read: all "no access"). The
 * stored token is rewritten at every Microsoft sign-in, the calendar grant, and each Graph token
 * refresh, so a role taken away in Entra shows here at the next of those.
 */
export async function entraSignIn(userId: string): Promise<{ microsoft: false } | { microsoft: true; role: "ADMIN" | "ADULT" | null; issuedAt: number | null }> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "microsoft" },
    // The latest, should a user ever hold two (the check reads them the same way).
    orderBy: { updatedAt: "desc" },
    select: { idToken: true },
  });
  if (!account) return { microsoft: false };
  const claims = account.idToken ? decodeIdTokenClaims(account.idToken) : null;
  return { microsoft: true, role: mapEntraRoleClaim(claims?.roles), issuedAt: typeof claims?.iat === "number" ? claims.iat : null };
}

export type EntraSignIn = Awaited<ReturnType<typeof entraSignIn>>;

/**
 * Phase 40.4: what a linked person's Microsoft sign-in means right now. No Microsoft account:
 * Entra has no say. No Admin/Adult role: no access, whatever the stored role. Ended by the Entra
 * check: back only with a token issued after that. Otherwise the role follows the token, but only
 * a token issued after the last good check (`lastOkAt`): an older one is what the check already
 * looked past, and following it would undo the check's change on every page (Fable's review).
 */
export function entraAccess(
  person: { role: string | null; entraAccessEndedAt: Date | null },
  entra: EntraSignIn,
  lastOkAt: Date | null = null,
): { kind: "none" } | { kind: "deny" } | { kind: "restore"; role: "ADMIN" | "ADULT" } | { kind: "role"; role: "ADMIN" | "ADULT" } {
  if (!entra.microsoft) return { kind: "none" };
  if (!entra.role) return { kind: "deny" };
  const issuedAfter = (when: Date) => entra.issuedAt !== null && entra.issuedAt * 1000 > when.getTime();
  if (person.entraAccessEndedAt) return issuedAfter(person.entraAccessEndedAt) ? { kind: "restore", role: entra.role } : { kind: "deny" };
  if (entra.role === person.role || (lastOkAt && !issuedAfter(lastOkAt))) return { kind: "none" };
  return { kind: "role", role: entra.role };
}

/** The Admin/Adult role a Microsoft sign-in's token gives, or null (none, or not Microsoft). */
export async function getEntraRole(userId: string) {
  const entra = await entraSignIn(userId);
  return entra.microsoft ? entra.role : null;
}

/**
 * Auto-provisions a Person for a first-time sign-in that didn't match any pre-seeded
 * record. Sign-in is already gated to our own single-tenant Entra app (see lib/auth.ts),
 * so anyone who can get a session here is a legitimate family member by construction — but
 * NOT necessarily an adult: kids have real M365 accounts too (they're just not meant to use
 * them against this app yet). A brand-new Person is only ever created here with a role
 * Entra has actually vouched for (Admin/Adult claim) — see getAuthPerson for why an
 * existing linked Person is handled differently.
 */
async function autoProvisionPerson(session: { user: { id: string; name: string } }, role: "ADMIN" | "ADULT") {
  const household = await prisma.household.findFirstOrThrow();
  const [firstName, ...rest] = session.user.name.trim().split(/\s+/);

  return prisma.person.create({
    data: {
      householdId: household.id,
      firstName: firstName || "New",
      lastName: rest.join(" ") || null,
      isHouseholdMember: true,
      role,
      authUserId: session.user.id,
    },
    omit: { photo: true },
  });
}

/**
 * The authenticated adult's own Person record (via Better Auth session), if any.
 * On a person's first-ever sign-in there's no link yet — we first try to adopt a
 * pre-seeded household record whose email matches (so seeding doesn't need to know Entra
 * user IDs in advance), and if nothing matches, auto-provision a new one. This must never
 * return null for an authenticated session: /sign-in redirects an existing session to
 * /profiles, and /profiles redirects a null getAuthPerson() back to /sign-in — an
 * unmatched sign-in with no fallback here is an infinite redirect loop, not a graceful
 * failure (this was a real bug, not a hypothetical).
 *
 * Role handling is asymmetric on purpose (Fable's Phase 4.5 scope review pushed back on
 * treating these the same; its later implementation review flagged that this trade-off
 * needed to be spelled out here rather than left implicit):
 * - New provisioning/adoption (nothing to lose): requires an actual Admin/Adult claim from
 *   Entra, redirecting to /not-provisioned otherwise — this is the path a kid's own M365
 *   account would hit, and it must not become a backdoor into ADULT.
 * - An already-linked Person (currently just the owner, from Phase 0): re-sync `role` from the
 *   claim on every request when a claim IS present (Entra is the source of truth per
 *   docs/PLAN.md's access-model decision), but if the claim is absent — e.g. the owner signs in
 *   before finishing the Entra app-role assignment, or their role is later removed in Entra —
 *   keep the existing DB role rather than revoking access. Trade-off: removing someone's
 *   Entra role does NOT retroactively revoke an already-linked person's app access; only
 *   their next request with an explicit different claim changes it. Deliberate for now —
 *   the owner is the only linked adult and access revocation isn't a live scenario yet — but
 *   revisit before this app has more than one household adult depending on it.
 *
 * A linked person whose row says they're not in the household (isHouseholdMember: false) is
 * checked BEFORE the resync above and on every request, not just on their next sign-in.
 * Settings → Household no longer removes linked people (Phase 38: Entra manages them), so
 * today that row comes from a database edit, but the check stays as defense in depth: their
 * stored idToken still carries whatever Entra claim it had at last login, so without this
 * check the resync immediately
 * above would silently write their role back on their very next page load, no
 * re-authentication required. Deliberately redirects here (same choke point as the
 * denied-new-provisioning path below) rather than only filtering isHouseholdMember in
 * getActiveProfile — a filter there alone would strand them in a picker showing no tiles
 * of their own, since app/profiles/page.tsx renders the signed-in adult's own tile from
 * this function's return value unconditionally.
 */
async function loadAuthPerson() {
  const session = await getServerSession();
  if (!session) return null;
  // DEV-ONLY testing sign-in (lib/dev-auth.ts): remove before shipping.
  if (isDevUser(session.user)) return devAuthPerson();

  const linked = await prisma.person.findUnique({
    where: { authUserId: session.user.id },
    omit: { photo: true },
  });
  if (linked) {
    if (!linked.isHouseholdMember) redirect("/not-provisioned");

    // Phase 40.4: a Microsoft sign-in with no Admin/Adult role has no access, whatever the
    // stored role says (Entra manages Microsoft people; this closes Phase 38's known gap), and
    // one the Entra check ended (lib/entra-check.ts) comes back only with a newer token.
    const entra = await entraSignIn(session.user.id);
    // Only a Microsoft sign-in needs the last good check (one more query, on their pages only).
    const lastOkAt = entra.microsoft
      ? ((await prisma.entraCheck.findUnique({ where: { householdId: linked.householdId }, select: { lastOkAt: true } }))?.lastOkAt ?? null)
      : null;
    const access = entraAccess(linked, entra, lastOkAt);
    if (access.kind === "deny") redirect("/not-provisioned");
    if (access.kind === "restore") {
      const restored = await prisma.person.update({
        where: { id: linked.id },
        data: { role: access.role, entraAccessEndedAt: null },
        omit: { photo: true },
      });
      await recordSignInEvent(prisma, {
        householdId: linked.householdId,
        kind: "ENTRA_ACCESS_RESTORED",
        actor: ENTRA,
        subject: { id: linked.id, firstName: linked.firstName },
      });
      return restored;
    }
    if (access.kind === "role") {
      return prisma.person.update({
        where: { id: linked.id },
        data: { role: access.role },
        omit: { photo: true },
      });
    }
    return linked;
  }

  // Phase 40.1c: a sign-in with no person yet, on an install with no household, is setup's
  // second step (setup's own passkey, or the first Microsoft sign-in): it finishes there.
  if (!(await isSetUp())) redirect("/setup/finish");

  const entraRole = await getEntraRole(session.user.id);
  if (!entraRole) {
    // redirect() throws internally and is handled by Next's router (a real navigation),
    // not by an error boundary — unlike a plain `throw` here, which Fable's Phase 4.5
    // implementation review found produced an unrecoverable 500 on every route (including
    // the one needed to sign out and retry).
    redirect("/not-provisioned");
  }

  if (session.user.email) {
    const unlinked = await prisma.person.findFirst({
      where: {
        authUserId: null,
        isHouseholdMember: true,
        email: { equals: session.user.email, mode: "insensitive" },
      },
      omit: { photo: true },
    });
    // Phase 40.2b: only while still unlinked, since an invite (lib/invites.ts) may have claimed
    // this person a moment ago; then this sign-in gets its own person instead.
    const { count } = unlinked
      ? await prisma.person.updateMany({ where: { id: unlinked.id, authUserId: null }, data: { authUserId: session.user.id, role: entraRole } })
      : { count: 0 };
    if (unlinked && count === 1) {
      return prisma.person.findUniqueOrThrow({ where: { id: unlinked.id }, omit: { photo: true } });
    }
  }

  return autoProvisionPerson(session, entraRole);
}

/**
 * Once per request, like getServerSession: the layout and the page each run
 * requireActiveProfile (which asks twice), and every uncached call repeats the person and
 * Entra-role lookups. The redirects above are thrown again from the cached result.
 */
export const getAuthPerson = cache(loadAuthPerson);

/**
 * The active profile for this browser (adult or kid), validated to belong to
 * the same household as the signed-in adult. Returns null if there's no
 * session, no cookie, or the cookie references a profile from elsewhere —
 * including a profile an admin has since removed from the household (the
 * `active_profile` cookie can otherwise outlive that by up to 30 days). The
 * signed-in adult's own removal is caught earlier, in getAuthPerson — this
 * catches removal of whichever profile (adult or kid) the cookie names, which
 * getAuthPerson never looks at.
 */
async function loadActiveProfile() {
  const authPerson = await getAuthPerson();
  if (!authPerson) return null;

  const personId = await readActiveProfileId();
  if (!personId) return null;

  const profile = await prisma.person.findUnique({
    where: { id: personId },
    omit: { photo: true },
  });
  if (!profile || profile.householdId !== authPerson.householdId || !profile.isHouseholdMember) {
    return null;
  }
  // Someone with their own sign-in (Microsoft or a passkey) is only ever reached by it (as in
  // verifyPinAndSelect), never by a cookie left from someone else's.
  if (profile.authUserId && profile.id !== authPerson.id) return null;

  return profile;
}

/** Once per request (see getAuthPerson). Choosing a profile sets the cookie and redirects, so the next request reads it. */
export const getActiveProfile = cache(loadActiveProfile);

/** Redirects to sign-in / profile picker until both session and profile exist. */
export async function requireActiveProfile() {
  const authPerson = await getAuthPerson();
  if (!authPerson) redirect("/sign-in");

  const profile = await getActiveProfile();
  if (!profile) redirect("/profiles");

  // Every page and action calls this, so it's the one place to tag Sentry events with who
  // was using the app: the opaque Person id only (Phase 15). Route handlers that use
  // getActiveProfile directly (e.g. the person-photo route) report errors without a user.
  setSentryUser(profile.id);
  return profile;
}

/**
 * True when the active profile IS the signed-in Entra session, not a kid or a different
 * adult reached via PIN-switch. Microsoft Graph tokens are per-session — gate any
 * Graph-backed UI/data (calendar, mail) with this, or it silently shows the signed-in
 * adult's data to whoever is currently PIN-selected, regardless of who that is.
 */
export async function isSessionOwner(profile: { authUserId: string | null }): Promise<boolean> {
  return isSessionOwnerFor(profile, await getServerSession());
}

/**
 * isSessionOwner, plus the temporary dev sign-in acting as its admin (DEV-ONLY, lib/dev-auth.ts;
 * remove before shipping). Money jars use this so they can be tested locally.
 */
export async function isOwnSignIn(profile: { id: string; authUserId: string | null }): Promise<boolean> {
  const session = await getServerSession();
  if (isSessionOwnerFor(profile, session)) return true;
  return isDevUser(session?.user) && profile.id === (await devAuthPerson()).id;
}

function isSessionOwnerFor(profile: { authUserId: string | null }, session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  if (!profile.authUserId) return false;
  return session?.user.id === profile.authUserId;
}

/**
 * Phase 28: what a backup button needs to know before it's pressed (the routes enforce the
 * same rules): is this the person themselves (own sign-in), is the sign-in fresh, and the
 * address to keep the account picker on. `dev` is DEV-ONLY (lib/dev-auth.ts). Phase 40.1b:
 * `microsoft` says whether signing in again can go through Microsoft (it's on for this install
 * and this sign-in has a Microsoft account); otherwise it's a fresh sign-in some other way.
 * Phase 40.1c: `passkey` says this sign-in has a passkey, which signs in again in place.
 */
export async function backupSignInState(profile: { id: string; authUserId: string | null }) {
  const session = await getServerSession();
  const microsoft =
    microsoftConfigFrom(process.env) !== null && session
      ? (await prisma.account.count({ where: { userId: session.user.id, providerId: "microsoft" } })) > 0
      : false;
  return {
    own: await isOwnSignIn(profile),
    fresh: await signedInRecently(),
    email: session?.user.email ?? undefined,
    dev: isDevUser(session?.user),
    microsoft,
    passkey: session ? (await prisma.passkey.count({ where: { userId: session.user.id } })) > 0 : false,
    // Phase 40.3: signs in again through the OIDC provider (configured, reachable at start).
    oidc:
      oidcConfigFrom(process.env) !== null && !oidcPreflightFailed() && session
        ? (await prisma.account.count({ where: { userId: session.user.id, providerId: OIDC_PROVIDER_ID } })) > 0
        : false,
  };
}
