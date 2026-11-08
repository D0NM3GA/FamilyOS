import { prisma } from "@/lib/prisma";
import { describeError } from "@/lib/observability/log";

// Phase 67b: the pure parts live in ./heartbeat-state (the reminder planner reads them without the database).
export * from "./heartbeat-state";

/**
 * Phase 61: when each background job last ran well and last failed (SystemHeartbeat), for the
 * System card on Data. One upsert per job per tick (every 30 minutes): nothing to the database.
 */

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
