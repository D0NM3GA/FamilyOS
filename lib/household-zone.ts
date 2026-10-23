import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { canonicalizeTimeZone } from "@/lib/household-settings";

/**
 * Phase 49: the server's clock is the household's. One server serves one household by design,
 * so the process zone is global state on purpose: Node picks up a change to `process.env.TZ` at
 * once, and every local `Date` getter, `toLocale…` and `Intl` default follows it. That makes
 * "today", due dates and every date the server prints the household's without passing a zone
 * through each date function (docs/PLAN.md, Phase 49).
 *
 * Stored days (local-midnight dates and dose times) are written in the process zone, so
 * `Household.dayZone` records which zone that was. Whenever it differs from the household's
 * zone, the days are moved first (keeping their date and clock time), then the zone is applied.
 * Nothing may keep a zone of its own: no `Intl.DateTimeFormat` at module level, no date worked
 * out at load (lib/household-zone-guard.test.ts).
 */

type ZoneState = { deployZone?: string; announced?: string };
const state = globalThis as typeof globalThis & { __familyosZone?: ZoneState };
const zoneState = (state.__familyosZone ??= {});

/** The process zone right now. */
export function processZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The zone the deploy started in (its `TZ`, else the machine's): used until a household zone is
 * set, and the zone days written before Phase 49 are in. Captured before the first change.
 */
export function deployZone(): string {
  return (zoneState.deployZone ??= processZone());
}

/**
 * Sets the process zone to `zone`, or back to the deploy's when it's null or not a zone. Only
 * the canonical name is ever set: an unknown one would silently become UTC. Returns whether it
 * changed.
 */
export function applyProcessZone(zone: string | null): boolean {
  const base = deployZone();
  const target = (zone && canonicalizeTimeZone(zone)) || base;
  if (processZone() === target) return false;
  process.env.TZ = target;
  if (zoneState.announced !== target) {
    zoneState.announced = target;
    console.info(`[zone] The server now keeps the household's time (${target}).`);
  }
  return true;
}

/**
 * Columns holding a day (or a day and a dose time) written in the process zone, moved when the
 * zone changes. Instants (createdAt, completedAt, doneAt on school rows, events) never move.
 * Each `where` limits the move to one household and, where a column mixes kinds, to the rows
 * that are days: an assignment only when typed in (an LMS connector's rows will carry their own
 * times), and a price only when it came from a receipt's printed date (exactly midnight).
 */
export const DAY_COLUMNS = [
  { table: "task_definition", column: "startDate", where: `"householdId" = $1` },
  {
    table: "task_instance",
    column: "dueDate",
    where: `"definitionId" IN (SELECT id FROM task_definition WHERE "householdId" = $1)`,
  },
  {
    table: "vehicle_maintenance_item",
    column: "lastDoneAt",
    where: `"vehicleId" IN (SELECT id FROM vehicle WHERE "householdId" = $1)`,
  },
  {
    table: "vehicle_service_log",
    column: "doneAt",
    where: `"itemId" IN (SELECT i.id FROM vehicle_maintenance_item i JOIN vehicle v ON v.id = i."vehicleId" WHERE v."householdId" = $1)`,
  },
  {
    table: "vehicle_fuel_log",
    column: "filledAt",
    where: `"vehicleId" IN (SELECT id FROM vehicle WHERE "householdId" = $1)`,
  },
  { table: "school_task", column: "dueDate", where: `"householdId" = $1` },
  {
    table: "school_assignment",
    column: "dueDate",
    where: `source = 'MANUAL' AND "profileId" IN (SELECT sp.id FROM school_profile sp JOIN person p ON p.id = sp."personId" WHERE p."householdId" = $1)`,
  },
  {
    table: "item_price",
    column: "observedAt",
    where: `"householdId" = $1 AND ("observedAt" AT TIME ZONE 'UTC' AT TIME ZONE $2)::time = '00:00'`,
  },
] as const;

/** A stored UTC wall time read as a date and clock time in $2, made the same date and time in $3. */
const moved = (column: string) =>
  `((("${column}" AT TIME ZONE 'UTC') AT TIME ZONE $2) AT TIME ZONE $3) AT TIME ZONE 'UTC'`;

/** Far enough that no moved value can meet a waiting one: the instance index is checked row by row. */
const PARKED = `interval '1000 years'`;

/**
 * Moves one household's stored days from zone `from` to zone `to`, keeping each value's date and
 * clock time: a chore due Tuesday stays due Tuesday, an 8:00 AM dose stays at 8:00 AM. A clock
 * time a DST change skips or repeats is settled by Postgres the same way every time. Task
 * instances are unique per (definition, due time), so they're parked first: a 12-hour move of an
 * 8 AM and an 8 PM dose would otherwise collide halfway. Two that land on the same time (a
 * skipped clock time) keep one, a done one over a waiting one. Returns rows moved per table.
 */
export async function moveStoredDays(
  tx: Prisma.TransactionClient,
  householdId: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (from === to) return counts;
  for (const { table, column, where } of DAY_COLUMNS) {
    if (table === "task_instance") {
      await tx.$executeRawUnsafe(`UPDATE task_instance SET "dueDate" = "dueDate" + ${PARKED} WHERE ${where}`, householdId);
      const parked = `("dueDate" - ${PARKED})`;
      const target = moved("dueDate").replace(`"dueDate"`, parked);
      // Same definition, same new time: keep the done one (then the oldest), drop the rest.
      await tx.$executeRawUnsafe(
        `DELETE FROM task_instance WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (
               PARTITION BY "definitionId", ${target}
               ORDER BY (status = 'DONE') DESC, (status = 'SKIPPED') DESC, "createdAt", id
             ) AS n
             FROM task_instance WHERE ${where} AND "dueDate" > now() + interval '900 years'
           ) ranked WHERE n > 1)`,
        householdId,
        from,
        to,
      );
      counts[table] = await tx.$executeRawUnsafe(
        `UPDATE task_instance SET "dueDate" = ${target} WHERE ${where} AND "dueDate" > now() + interval '900 years'`,
        householdId,
        from,
        to,
      );
      continue;
    }
    counts[table] = await tx.$executeRawUnsafe(
      `UPDATE ${table} SET "${column}" = ${moved(column)} WHERE "${column}" IS NOT NULL AND ${where}`,
      householdId,
      from,
      to,
    );
  }
  return counts;
}

/** Held exclusively while days move; shared by whatever writes new days (instance generation). */
const DAY_ZONE_LOCK = "familyos-day-zone";

/** Taken by whatever moves or replaces every stored day (a zone change, a restore). */
export async function lockStoredDays(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DAY_ZONE_LOCK}))`;
}

/** Runs `fn` in a transaction that waits out a move, so no day is written in the old zone halfway through one. */
export function withStoredDays<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${DAY_ZONE_LOCK}))`;
    return fn(tx);
  });
}

export type ZoneSync = { moved: Record<string, number>; from: string; to: string } | null;

/**
 * Brings the process zone and the stored days in line with the household's zone: moves the days
 * when `dayZone` differs (from the deploy's zone when it was never set, which covers installs
 * upgraded to Phase 49), then applies the zone. The zone is set before the move commits, so
 * whatever was waiting on the lock wakes in the new zone; a failed move puts the old one back.
 * `from` overrides where the days are now (a restore: the backup's zone). Returns what moved.
 */
export async function syncHouseholdZone(householdId: string, opts: { from?: string } = {}): Promise<ZoneSync> {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { timezone: true, dayZone: true } });
  if (!household) return null;
  const to = household.timezone ? canonicalizeTimeZone(household.timezone) : null;
  if (!to) {
    applyProcessZone(null);
    return null;
  }
  if (!opts.from && household.dayZone === to) {
    applyProcessZone(to);
    return null;
  }
  const before = process.env.TZ;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockStoredDays(tx);
      // Again under the lock: another request may have just done this move.
      const now = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { dayZone: true } });
      const from = opts.from ?? (now.dayZone ? (canonicalizeTimeZone(now.dayZone) ?? deployZone()) : deployZone());
      const counts = await moveStoredDays(tx, householdId, from, to);
      await tx.household.update({ where: { id: householdId }, data: { dayZone: to } });
      applyProcessZone(to);
      return from === to ? null : { moved: counts, from, to };
    });
  } catch (err) {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
    throw err;
  }
}

/**
 * The per-request and per-tick check: a string compare when nothing changed, the full sync when
 * the household's zone and its days' zone differ (another app instance saved a new zone).
 */
export async function followHouseholdZone(household: { id: string; timezone: string | null; dayZone: string | null }): Promise<void> {
  const to = household.timezone ? canonicalizeTimeZone(household.timezone) : null;
  if (!to) applyProcessZone(null);
  else if (household.dayZone === to) applyProcessZone(to);
  else await syncHouseholdZone(household.id);
}

/** At start and on each background tick: the one household, if there is one yet. */
export async function syncServerZone(): Promise<void> {
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (household) await syncHouseholdZone(household.id);
}
