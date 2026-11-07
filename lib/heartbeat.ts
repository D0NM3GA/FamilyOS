import { prisma } from "@/lib/prisma";
import { describeError } from "@/lib/observability/log";

/**
 * Phase 61: when each background job last ran well and last failed (SystemHeartbeat), for the
 * System card on Data. One upsert per job per tick (every 30 minutes): nothing to the database.
 */

export type JobName = "zone" | "money" | "purges" | "entra" | "cleanup";

/** The jobs in the order they run, with how the System card names them. */
export const JOBS: { name: JobName; label: string }[] = [
  { name: "zone", label: "Household clock" },
  { name: "money", label: "Money syncs and alerts" },
  { name: "purges", label: "Expired sign-in links and invites" },
  { name: "entra", label: "Microsoft access check" },
  { name: "cleanup", label: "Tidying old sessions and notifications" },
];

/** The host's nightly backup writes this row itself (scripts/backup-prod.sh). */
export const BACKUP_HEARTBEAT = "backup";

// An upsert on the primary key is one INSERT … ON CONFLICT: several app instances can write the same row.
export async function recordOk(name: string, detail: string | null = null, now: Date = new Date()) {
  await prisma.systemHeartbeat.upsert({
    where: { name },
    create: { name, lastOkAt: now, detail, updatedAt: now },
    update: { lastOkAt: now, detail, updatedAt: now },
  });
}

export async function recordFailure(name: string, err: unknown, now: Date = new Date()) {
  const lastError = describeError(err);
  await prisma.systemHeartbeat.upsert({
    where: { name },
    create: { name, lastErrorAt: now, lastError, updatedAt: now },
    update: { lastErrorAt: now, lastError, updatedAt: now },
  });
}

export function readHeartbeats() {
  return prisma.systemHeartbeat.findMany({ orderBy: { name: "asc" } });
}

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
