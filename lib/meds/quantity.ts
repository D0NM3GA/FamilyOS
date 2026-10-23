/**
 * Pure quantity-tracking math — no Prisma — so the branching in app/(app)/meds/actions.ts's
 * completeInstance/uncompleteInstance has nothing left to get wrong. Same split as
 * lib/tasks/queries.ts's bucketInstances or lib/people.ts's pickStaleContacts.
 */

/**
 * How much a dose consumes, given the medication's configured dose amount — null when
 * quantity tracking isn't configured (either quantityOnHand or doseAmount is unset). The
 * caller stores this verbatim as TaskInstance.quantityConsumed, so a later undo restores
 * the right amount regardless of any doseAmount edit in between.
 *
 * Deliberately doesn't also decide "does this need a refill" — that has to be judged
 * against quantityOnHand's value AFTER the decrement actually lands, and this function has
 * no way to know a concurrent dose/restock isn't changing that value at the same instant.
 * See isLowStock below, called against the real post-write row instead.
 */
export function doseConsumption(quantityOnHand: number | null, doseAmount: number | null): number | null {
  if (quantityOnHand == null || doseAmount == null) return null;
  return doseAmount;
}

/** Read-time "Low"/needs-refill check — used both for the manage page's badge (against
 * whatever quantityOnHand currently is) and, in completeInstance, against the row a
 * decrement just produced. The single definition of "low," not two slightly different ones. */
export function isLowStock(quantityOnHand: number | null, refillThresholdQuantity: number | null): boolean {
  if (quantityOnHand == null || refillThresholdQuantity == null) return false;
  return quantityOnHand <= refillThresholdQuantity;
}
