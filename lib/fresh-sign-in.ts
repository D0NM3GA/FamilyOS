/** Phase 28: how recent a sign-in must be for a backup, a restore or removing a passkey (seconds). */
export const FRESH_SIGN_IN_SECONDS = 15 * 60;

/**
 * Phase 40.2: anything that makes a new way in (adding a passkey, 40.2a; inviting someone,
 * 40.2b) hands out lasting access, not a one-off, so it wants a sign-in from the last 5 minutes,
 * not 15 (Fable's review): a tablet left on someone's own profile is a much shorter window for
 * anyone else to add their own device or invite themselves.
 */
export const NEW_WAY_IN_SECONDS = 5 * 60;

/**
 * Whether a session is still "fresh": made in the last `seconds`. A session's createdAt is its
 * sign-in time; Better Auth's refresh only moves expiresAt and updatedAt.
 */
export function isFreshSession(createdAt: Date | string, now: number = Date.now(), seconds: number = FRESH_SIGN_IN_SECONDS): boolean {
  return now - new Date(createdAt).getTime() < seconds * 1000;
}
