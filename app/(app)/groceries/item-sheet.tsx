import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { getItemForSheet, getSections, getStores, getUsuals } from "@/lib/groceries/queries";
import { describeLastPrice, getLastPrices } from "@/lib/groceries/receipts";
import { describeEvery } from "@/lib/groceries/usual";
import { amountLabel } from "@/lib/groceries/size";
import { prisma } from "@/lib/prisma";
import { ItemSheetForm } from "./item-sheet-form";
import type { SheetReturn } from "./actions";

/**
 * Phase 22's item sheet, opened by `?item=<productId>` on /groceries or /groceries/pantry so
 * the phone's Back button closes it. Household-scoped read: a foreign or stale id simply
 * shows no sheet.
 */
export async function ItemSheet({
  productId,
  profile,
  returnTo,
}: {
  productId: string;
  profile: { id: string; householdId: string; role: "ADULT" | "KID" | "ADMIN" | null };
  returnTo: SheetReturn;
}) {
  const product = await getItemForSheet(profile.householdId, productId);
  if (!product) return null;

  const adult = isAdult(profile);
  const [stores, sections, usuals, listRow, members, others] = await Promise.all([
    getStores(profile.householdId),
    getSections(profile.householdId),
    getUsuals(profile.householdId, [product.id]),
    prisma.shoppingListItem.findFirst({
      where: { productId: product.id, done: false, list: { householdId: profile.householdId } },
      select: { id: true, requestedById: true },
    }),
    getHouseholdMembers(profile.householdId),
    adult
      ? prisma.product.findMany({
          where: { householdId: profile.householdId, id: { not: product.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Prices are money: grown-ups only (Phase 24).
  const lastPrice = adult ? (await getLastPrices(profile.householdId, [product.id])).get(product.id) : undefined;
  const usual = usuals.get(product.id);
  const every = describeEvery(usual?.everyDays ?? null);
  const usualText = usual
    ? `${amountLabel(usual.quantity, product.container)}${every ? ` ${every}` : ""} · from ${usual.trips} trip${usual.trips === 1 ? "" : "s"}`
    : null;

  return (
    // Keyed on the saved version: after a merge or a jump to another item the form's
    // local state must start over from the database, not keep the old item's fields.
    <ItemSheetForm
      key={`${product.id}:${product.updatedAt.getTime()}`}
      product={{
        id: product.id,
        name: product.name,
        brand: product.brand,
        imageUrl: product.imageUrl,
        barcode: product.barcode,
        sizeAmount: product.sizeAmount,
        sizeUnit: product.sizeUnit,
        container: product.container,
        defaultStoreId: product.defaultStoreId,
        groupId: product.groupId,
      }}
      stores={stores}
      sections={sections}
      usualText={usualText}
      lastPriceText={lastPrice ? describeLastPrice(lastPrice) : null}
      listRow={listRow}
      members={members.map((m) => ({ id: m.id, firstName: m.firstName }))}
      others={others}
      canTidy={adult}
      returnTo={returnTo}
    />
  );
}
