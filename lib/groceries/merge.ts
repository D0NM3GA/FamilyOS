import { prisma } from "@/lib/prisma";

export type MergeResult = { ok: true; name: string } | { ok: false; reason: "same" | "notFound" };

/**
 * Folds one Pantry item into another ("Same as…", Phase 22): the kept item gains the merged
 * one's list rows and purchase history, fills any of its own blank details from it, and the
 * merged item is deleted. One transaction, both ids household-scoped.
 *
 * - List: if both are on the list unchecked, one row survives with the quantities added
 *   (the kept row's "for" wins). Every other row is just re-pointed.
 * - History: purchase rows, receipt prices and learned receipt lines are re-pointed; a
 *   purchase row's description (the name at the time) stays.
 * - Barcode: the merged item's barcode moves over only when the kept item has none; if both
 *   have one, the merged barcode is dropped (a product holds one code). Cleared before the
 *   update so the (householdId, barcode) unique index never sees it twice.
 */
export async function mergeProducts(householdId: string, keepId: string, mergeId: string): Promise<MergeResult> {
  if (keepId === mergeId) return { ok: false, reason: "same" };

  return prisma.$transaction(async (tx) => {
    const [keep, merge] = await Promise.all([
      tx.product.findFirst({ where: { id: keepId, householdId } }),
      tx.product.findFirst({ where: { id: mergeId, householdId } }),
    ]);
    if (!keep || !merge) return { ok: false, reason: "notFound" } as const;

    const [keepOpen, mergeOpen] = await Promise.all([
      tx.shoppingListItem.findFirst({ where: { productId: keep.id, done: false }, orderBy: { createdAt: "asc" } }),
      tx.shoppingListItem.findFirst({ where: { productId: merge.id, done: false }, orderBy: { createdAt: "asc" } }),
    ]);
    if (keepOpen && mergeOpen) {
      await tx.shoppingListItem.update({
        where: { id: keepOpen.id },
        data: { quantity: keepOpen.quantity + mergeOpen.quantity, requestedById: keepOpen.requestedById ?? mergeOpen.requestedById },
      });
      await tx.shoppingListItem.delete({ where: { id: mergeOpen.id } });
    }
    await tx.shoppingListItem.updateMany({ where: { productId: merge.id }, data: { productId: keep.id } });
    await tx.purchaseItem.updateMany({ where: { productId: merge.id }, data: { productId: keep.id } });
    // Phase 24: prices and learned receipt lines follow too (both would cascade away).
    await tx.itemPrice.updateMany({ where: { productId: merge.id }, data: { productId: keep.id } });
    await tx.receiptAlias.updateMany({ where: { productId: merge.id }, data: { productId: keep.id } });

    const barcode = keep.barcode ?? merge.barcode;
    if (merge.barcode) await tx.product.update({ where: { id: merge.id }, data: { barcode: null } });

    const hasSize = keep.sizeAmount != null || keep.sizeUnit != null || keep.container != null;
    await tx.product.update({
      where: { id: keep.id },
      data: {
        barcode,
        brand: keep.brand ?? merge.brand,
        imageUrl: keep.imageUrl ?? merge.imageUrl,
        defaultStoreId: keep.defaultStoreId ?? merge.defaultStoreId,
        groupId: keep.groupId ?? merge.groupId,
        ...(hasSize ? {} : { sizeAmount: merge.sizeAmount, sizeUnit: merge.sizeUnit, container: merge.container }),
      },
    });
    await tx.product.delete({ where: { id: merge.id } });
    return { ok: true, name: keep.name } as const;
  });
}
