import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { canonicalizeTimeZone } from "@/lib/household-settings";
import { captureError } from "@/lib/observability";
import { sameClockIn, wallClock } from "@/lib/zone-clock";

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
  return true;
}

/** Says once per zone that the server switched (only after the switch has stuck). */
function announce(zone: string): void {
  if (zoneState.announced === zone) return;
  zoneState.announced = zone;
  console.info(`[zone] The server now keeps the household's time (${zone}).`);
}

/**
 * Columns holding a day (or a day and a dose time) written in the process zone, moved when the
 * zone changes. Instants (createdAt, completedAt, doneAt on school rows, events) never move.
 * Each `where` limits the move to one household and, where a column mixes kinds, to the rows
 * that are days: an assignment only when typed in (an LMS connector's rows will carry their own
 * times), and a price only when it came from a receipt's printed date (`midnightOnly`).
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
  { table: "item_price", column: "observedAt", where: `"householdId" = $1`, midnightOnly: true },
] as const;

/** Far enough that no parked value can meet a waiting one: the instance index is checked row by row. */
const PARKED = `interval '365000 days'`;

type Row = { id: string; at: Date; definitionId?: string; status?: string; createdAt?: Date };

/** Writes each row's new value in one statement (timestamp(3) holds UTC wall time; the Z is dropped). */
async function writeAll(tx: Prisma.TransactionClient, table: string, column: string, rows: { id: string; at: Date }[], shift = "") {
  if (rows.length === 0) return;
  await tx.$executeRawUnsafe(
    `UPDATE ${table} AS t SET "${column}" = v.at::timestamp(3)${shift} FROM unnest($1::text[], $2::text[]) AS v(id, at) WHERE t.id = v.id`,
    rows.map((r) => r.id),
    rows.map((r) => r.at.toISOString()),
  );
}

/**
 * Moves one household's stored days from zone `from` to zone `to`, keeping each value's date and
 * clock time: a chore due Tuesday stays due Tuesday, an 8:00 AM dose stays at 8:00 AM. Worked out
 * here with the app's own zone data (lib/zone-clock.ts), never Postgres's, whose zone list can
 * lack a name Intl calls canonical. Task instances are unique per (definition, due time), so
 * they're parked first: a 12-hour move of an 8 AM and an 8 PM dose would otherwise collide
 * halfway. Two that land on the same time (a skipped clock time) keep one, a done one over a
 * waiting one. Returns rows moved per table.
 */
export async function moveStoredDays(
  tx: Prisma.TransactionClient,
  householdId: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (from === to) return counts;
  for (const col of DAY_COLUMNS) {
    const { table, column, where } = col;
    const extra = table === "task_instance" ? `, "definitionId", status::text AS status, "createdAt"` : "";
    const found = await tx.$queryRawUnsafe<Row[]>(
      `SELECT id, "${column}" AS at${extra} FROM ${table} WHERE "${column}" IS NOT NULL AND ${where}`,
      householdId,
    );
    const days = "midnightOnly" in col ? found.filter((r) => isMidnight(r.at, from)) : found;
    const moved = days.map((r) => ({ ...r, at: sameClockIn(r.at, from, to) })).filter((r, i) => r.at.getTime() !== days[i].at.getTime());
    if (table !== "task_instance") {
      await writeAll(tx, table, column, moved);
      counts[table] = moved.length;
      continue;
    }
    // Same definition, same new time: keep the done one (then skipped, then the oldest).
    const rank = (r: Row) => (r.status === "DONE" ? 0 : r.status === "SKIPPED" ? 1 : 2);
    const byId = new Map(moved.map((m) => [m.id, m]));
    const all = days.map((r) => byId.get(r.id) ?? r);
    const keep = new Map<string, Row>();
    for (const r of all) {
      const key = `${r.definitionId} ${r.at.getTime()}`;
      const held = keep.get(key);
      if (!held || rank(r) < rank(held) || (rank(r) === rank(held) && r.createdAt! < held.createdAt!)) keep.set(key, r);
    }
    const kept = new Set([...keep.values()].map((r) => r.id));
    const dropped = all.filter((r) => !kept.has(r.id)).map((r) => r.id);
    if (dropped.length) await tx.$executeRawUnsafe(`DELETE FROM task_instance WHERE id = ANY($1::text[])`, dropped);
    const going = moved.filter((r) => kept.has(r.id));
    await writeAll(tx, table, column, going, ` + ${PARKED}`);
    await writeAll(tx, table, column, going);
    counts[table] = going.length;
  }
  return counts;
}

/** Exactly midnight in `zone`: a receipt's printed date, not a moment something happened. */
function isMidnight(at: Date, zone: string): boolean {
  const c = wallClock(at, zone);
  return c.h === 0 && c.mi === 0 && c.s === 0 && c.ms === 0;
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

/** The zone the days should be in for a household zone (null: the deploy's), and what dayZone records then. */
function targetFor(timezone: string | null): { to: string; dayZone: string | null } {
  const zone = timezone ? canonicalizeTimeZone(timezone) : null;
  return zone ? { to: zone, dayZone: zone } : { to: deployZone(), dayZone: null };
}

/**
 * Brings the stored days and the process zone in line with the household's zone, in one
 * transaction: the days move from `dayZone` (the deploy's zone when it was never set, which covers
 * installs upgraded to Phase 49) to the household's zone (the deploy's when it has none), then the
 * zone is applied. With `timezone`, that's also saved, so a save never leaves a zone whose days
 * didn't move. The zone is set before the move commits, so whatever waited on the lock wakes in the
 * new zone; a failed move puts the old one back. Returns what moved.
 */
export async function syncHouseholdZone(householdId: string, save?: { timezone: string | null }): Promise<ZoneSync> {
  if (!save) {
    const household = await prisma.household.findUnique({ where: { id: householdId }, select: { timezone: true, dayZone: true } });
    if (!household) return null;
    const target = targetFor(household.timezone);
    if (household.dayZone === target.dayZone) {
      applyProcessZone(target.to);
      announce(target.to);
      return null;
    }
  }
  const before = process.env.TZ;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockStoredDays(tx);
      // Again under the lock: another request may have just done this move.
      const now = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true, dayZone: true } });
      const timezone = save ? save.timezone : now.timezone;
      const target = targetFor(timezone);
      const from = (now.dayZone && canonicalizeTimeZone(now.dayZone)) || deployZone();
      const counts = await moveStoredDays(tx, householdId, from, target.to);
      await tx.household.update({ where: { id: householdId }, data: { dayZone: target.dayZone, ...(save ? { timezone: target.dayZone } : {}) } });
      applyProcessZone(target.to);
      return from === target.to ? null : { moved: counts, from, to: target.to };
    });
    announce(processZone());
    return result;
  } catch (err) {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
    throw err;
  }
}

/**
 * The per-request check: a string compare when nothing changed, the full sync when the days'
 * zone isn't the household's (another app instance saved a new zone). A failed sync never takes
 * the page down: the server keeps the zone it has, and the error is reported.
 */
export async function followHouseholdZone(household: { id: string; timezone: string | null; dayZone: string | null }): Promise<void> {
  const target = targetFor(household.timezone);
  if (household.dayZone === target.dayZone) {
    applyProcessZone(target.to);
    return;
  }
  try {
    await syncHouseholdZone(household.id);
  } catch (err) {
    captureError(new Error(`household zone sync failed: ${err instanceof Error ? err.constructor.name : "unknown"}`));
  }
}

/** At start and on each background tick: the one household, if there is one yet. */
export async function syncServerZone(): Promise<void> {
  const household = await prisma.household.findFirst({ select: { id: true } });
  if (household) await syncHouseholdZone(household.id);
}
