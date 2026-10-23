import { Prisma } from "@/app/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { productNameKey } from "@/lib/product-name";

export { productNameKey };

/**
 * One persistent running list per household — created on first visit, never closed out.
 * Lives here (kernel), not in lib/groceries/queries.ts, because Meds' refill hook
 * (app/(app)/meds/actions.ts) needs it too, and app/(app)/meds/** may not import
 * @/lib/groceries/* per eslint.config.mjs's domain-boundary rule.
 *
 * A single atomic `upsert` against `ShoppingList.householdId`'s unique constraint, not a
 * find-then-create — the latter would still race against itself even centralized in one
 * function, and Phase 9's refill hook is the first caller that can fire with nobody on
 * /groceries to have already triggered the find-or-create a page load normally would.
 */
export async function getOrCreateActiveList(householdId: string) {
  return prisma.shoppingList.upsert({
    where: { householdId },
    create: { householdId },
    update: {},
  });
}

/**
 * The household's Pantry item for a typed name, creating it if it's new. Race-safe on the
 * (householdId, nameKey) unique index: a concurrent create of the same name re-finds the
 * winner instead of erroring. Returns `created` so the groceries domain can suggest a
 * section for brand-new items (the kernel can't import lib/groceries).
 */
export async function findOrCreateProductByName(
  householdId: string,
  rawName: string,
  db: Tx | typeof prisma = prisma,
): Promise<{ product: { id: string; name: string }; created: boolean }> {
  const name = rawName.trim().replace(/\s+/g, " ");
  const nameKey = productNameKey(name);
  if (!nameKey) throw new Error("A Pantry item needs a name.");

  const existing = await db.product.findUnique({
    where: { householdId_nameKey: { householdId, nameKey } },
    select: { id: true, name: true },
  });
  if (existing) return { product: existing, created: false };

  try {
    const product = await db.product.create({
      data: { householdId, name, nameKey },
      select: { id: true, name: true },
    });
    return { product, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const race = await db.product.findUnique({
        where: { householdId_nameKey: { householdId, nameKey } },
        select: { id: true, name: true },
      });
      if (race) return { product: race, created: false };
    }
    throw err;
  }
}

/**
 * Makes sure a named item is on the household's list, for other apps' hooks (Meds' refill,
 * Vehicles' low supplies). Dedupes against any row for that item, checked off or not: a
 * checked-but-not-yet-purchased row means it's already been asked for, so this is "make sure
 * it's there", not "add another one" (unlike the groceries add box, which increments).
 */
export async function requestItemByName(opts: {
  householdId: string;
  name: string;
  addedById: string;
  requestedById?: string | null;
}): Promise<{ created: boolean }> {
  const list = await getOrCreateActiveList(opts.householdId);
  const { product } = await findOrCreateProductByName(opts.householdId, opts.name);

  const existing = await prisma.shoppingListItem.findFirst({
    where: { listId: list.id, productId: product.id },
  });
  if (existing) return { created: false };

  await prisma.shoppingListItem.create({
    data: {
      listId: list.id,
      productId: product.id,
      addedById: opts.addedById,
      requestedById: opts.requestedById ?? null,
    },
  });
  return { created: true };
}
