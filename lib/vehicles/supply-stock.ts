import type { prisma } from "@/lib/prisma";
import { isSupplyLow } from "./supplies";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Stock arithmetic for logged services (Phase 12.5), in SQL so it's atomic. Prisma's
 * `decrement` can't clamp at zero, and reading first then writing races a concurrent
 * "+ stock" or a second service log: the amount recorded as taken would be wrong, and an
 * undo would then restore the wrong amount (the same race Phase 9 fixed for meds). Each
 * statement locks the row, and the amount taken is derived from the locked value.
 */

/**
 * Takes each item supply's per-service amount from stock (clamped at zero, tracked and
 * active supplies only) and records what was actually taken against the log. Returns the
 * names of supplies that are low afterwards, judged against the row just written.
 */
export async function consumeForService(
  tx: Tx,
  opts: { householdId: string; logId: string; itemId: string },
): Promise<string[]> {
  // Locked in id order, here and in restoreForUndo: two services sharing supplies must take
  // their row locks in the same order, or they can deadlock.
  const links = await tx.vehicleItemSupply.findMany({
    where: { itemId: opts.itemId },
    select: { supplyId: true, quantity: true },
    orderBy: { supplyId: "asc" },
  });
  const low: string[] = [];
  for (const link of links) {
    const [row] = await tx.$queryRaw<{ before: number; after: number; lowThreshold: number | null; name: string }[]>`
      WITH locked AS (
        SELECT id, "quantityOnHand" AS q FROM vehicle_supply
        WHERE id = ${link.supplyId} AND "householdId" = ${opts.householdId}
          AND active AND "quantityOnHand" IS NOT NULL
        FOR UPDATE
      )
      UPDATE vehicle_supply s
      SET "quantityOnHand" = ROUND(GREATEST(0, locked.q - ${link.quantity})::numeric, 3)::float8, "updatedAt" = now()
      FROM locked WHERE s.id = locked.id
      RETURNING locked.q AS before, s."quantityOnHand" AS after, s."lowThreshold" AS "lowThreshold", s.name AS name`;
    if (!row) continue; // untracked, inactive, or not this household's
    const taken = Math.round((row.before - row.after) * 1000) / 1000;
    if (taken > 0) {
      await tx.vehicleServiceSupplyUse.create({ data: { logId: opts.logId, supplyId: link.supplyId, quantity: taken } });
    }
    if (isSupplyLow(row.after, row.lowThreshold)) low.push(row.name);
  }
  return low;
}

/**
 * Puts back what a log took, before the log is deleted (its use rows cascade). A supply
 * that has since become untracked (on hand cleared) stays untracked.
 */
export async function restoreForUndo(tx: Tx, logId: string): Promise<void> {
  const uses = await tx.vehicleServiceSupplyUse.findMany({ where: { logId }, orderBy: { supplyId: "asc" } });
  for (const use of uses) {
    await tx.$executeRaw`
      UPDATE vehicle_supply
      SET "quantityOnHand" = ROUND(("quantityOnHand" + ${use.quantity})::numeric, 3)::float8, "updatedAt" = now()
      WHERE id = ${use.supplyId} AND "quantityOnHand" IS NOT NULL`;
  }
}

/**
 * "+ stock": adds to a tracked supply's count, rounded in SQL like the other two so a run
 * of fractional restocks can't drift (0.1 + 0.2 must be 0.3, or "low at 5" misfires).
 * Returns false when the supply isn't this household's, or isn't tracked (a null count
 * would silently stay null).
 */
export async function addStock(db: Pick<Tx, "$executeRaw">, householdId: string, supplyId: string, amount: number): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE vehicle_supply
    SET "quantityOnHand" = ROUND(("quantityOnHand" + ${amount})::numeric, 3)::float8, "updatedAt" = now()
    WHERE id = ${supplyId} AND "householdId" = ${householdId} AND "quantityOnHand" IS NOT NULL`;
  return count > 0;
}
