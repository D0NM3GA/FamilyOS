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
 * Phase 66a: low is isMedLow (lib/reminders/supply.ts), judged on the row the stock write returns
 * (lib/meds/stock.ts).
 */
export function doseConsumption(quantityOnHand: number | null, doseAmount: number | null): number | null {
  if (quantityOnHand == null || doseAmount == null) return null;
  return doseAmount;
}
