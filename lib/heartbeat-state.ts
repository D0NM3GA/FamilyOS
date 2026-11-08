/**
 * Phase 61: the background jobs and where a heartbeat stands, pure (no database), for Data's
 * System card and (Phase 67b) the admins' system reminder. lib/heartbeat.ts re-exports these.
 */

export type JobName = "zone" | "money" | "purges" | "entra" | "cleanup" | "reminders";

/** The jobs in the order they run, with how the System card names them. */
export const JOBS: { name: JobName; label: string }[] = [
  { name: "zone", label: "Household clock" },
  { name: "money", label: "Money syncs and alerts" },
  { name: "purges", label: "Expired sign-in links and invites" },
  { name: "entra", label: "Microsoft access check" },
  { name: "reminders", label: "Reminders" },
  { name: "cleanup", label: "Tidying old sessions and notifications" },
];

/** The host's nightly backup writes this row itself (scripts/backup-prod.sh). */
export const BACKUP_HEARTBEAT = "backup";

export type HeartbeatRow = { name: string; lastOkAt: Date | null; lastErrorAt: Date | null; lastError: string | null; detail: string | null };
export type HeartbeatState = "ok" | "late" | "failing" | "never";

/** A job is late after three missed ticks (30 minutes each); the nightly backup after 36 hours. */
export const JOB_LATE_MS = 3 * 30 * 60_000 + 5 * 60_000;
export const BACKUP_LATE_MS = 36 * 60 * 60_000;

/** Where a heartbeat stands. Pure. */
export function heartbeatState(row: HeartbeatRow | undefined, lateAfterMs: number, now: Date = new Date()): HeartbeatState {
  if (!row || (!row.lastOkAt && !row.lastErrorAt)) return "never";
  if (row.lastErrorAt && (!row.lastOkAt || row.lastErrorAt > row.lastOkAt)) return "failing";
  if (!row.lastOkAt || now.getTime() - row.lastOkAt.getTime() > lateAfterMs) return "late";
  return "ok";
}
