import type { prisma } from "@/lib/prisma";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Phase 66a: medicine stock arithmetic in SQL, like the Garage's (lib/vehicles/supply-stock.ts).
 * Prisma's `decrement` can't stop at zero, so an uncounted bottle read "-3 on hand", and float
 * steps (0.1 + 0.2) drifted until "low at 5" fired a dose late. Each statement locks the row,
 * clamps at zero and rounds to three places, and the amount taken is worked out from the locked
 * value, so Undo gives back what was really taken.
 */

/**
 * Takes up to `amount` from a counted medicine. Null when it isn't counted (no number on hand)
 * or isn't there; otherwise what was taken (0 from an empty bottle) and what's left.
 */
export async function takeStock(tx: Tx, medicationId: string, amount: number): Promise<{ taken: number; after: number } | null> {
  const [row] = await tx.$queryRaw<{ before: number; after: number }[]>`
    WITH locked AS (
      SELECT id, "quantityOnHand" AS q FROM medication
      WHERE id = ${medicationId} AND "quantityOnHand" IS NOT NULL
      FOR UPDATE
    )
    UPDATE medication m
    SET "quantityOnHand" = ROUND(GREATEST(0, locked.q - ${amount})::numeric, 3)::float8, "updatedAt" = now()
    FROM locked WHERE m.id = locked.id
    RETURNING locked.q AS before, m."quantityOnHand" AS after`;
  if (!row) return null;
  return { taken: roundStock(row.before - row.after), after: row.after };
}

/**
 * Puts stock back (an undone dose) or adds to it ("+ stock"). A medicine whose count was cleared
 * since stays uncounted. False when nothing was changed.
 */
export async function addToStock(db: Tx | typeof prisma, medicationId: string, amount: number): Promise<boolean> {
  if (!(amount > 0)) return false;
  const changed = await db.$executeRaw`
    UPDATE medication
    SET "quantityOnHand" = ROUND(("quantityOnHand" + ${amount})::numeric, 3)::float8, "updatedAt" = now()
    WHERE id = ${medicationId} AND "quantityOnHand" IS NOT NULL`;
  return changed > 0;
}

/** Three places, the same as the SQL: 0.1 + 0.2 reads 0.3. */
export function roundStock(n: number): number {
  return Math.round(n * 1000) / 1000;
}
