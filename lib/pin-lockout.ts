/**
 * PIN lockout timing (app/profiles/actions.ts). Every 5th wrong PIN in a row locks the
 * profile, and each lock is twice as long as the one before: 15 minutes, 30, 1 hour, 2, 4,
 * 8, 16, then a day at most. Only a right PIN resets the count.
 */
const FIRST_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

/** How long the nth lock (1-based) lasts. */
export function lockoutMs(lockNumber: number): number {
  const n = Math.max(1, Math.floor(lockNumber));
  return Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** Math.min(n - 1, 16));
}

/** "15 minutes", "2 hours", "a day": rounded up, so it's never sooner than said. */
export function lockLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return "a day";
}
