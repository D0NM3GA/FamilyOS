import { prisma } from "@/lib/prisma";
import { notifyPerson } from "@/lib/notifications";
import { getUsuals } from "./queries";
import type { RemovedRow } from "./undo";

// List writes shared by the groceries actions (Phase 23), kept out of the "use server" file
// so the database tests can call them directly.

/**
 * Puts a Pantry item on the list. A repeat add of something already unchecked on the list
 * adds one more, like a second tap of "+"; a fresh row starts at the family's usual amount.
 * A kid's fresh row is their pick (Phase 23): tagged for them and vetoable by a grown-up. A
 * kid's repeat add leaves an existing row's "for" and pick status alone.
 */
export async function addProductToList(
  householdId: string,
  listId: string,
  productId: string,
  adder: { id: string; role: "ADULT" | "KID" | "ADMIN" | null },
) {
  const existing = await prisma.shoppingListItem.findFirst({
    where: { listId, productId, done: false },
  });
  if (existing) {
    await prisma.shoppingListItem.update({
      where: { id: existing.id },
      data: { quantity: { increment: 1 } },
    });
    return;
  }
  const usual = (await getUsuals(householdId, [productId])).get(productId);
  await prisma.shoppingListItem.create({
    data: {
      listId,
      productId,
      addedById: adder.id,
      quantity: usual?.quantity ?? 1,
      ...(adder.role === "KID" ? { requestedById: adder.id, kidPick: true } : {}),
    },
  });
}

/**
 * The row's − at one: takes it off the list and hands back what it was, for Undo. Null
 * when it's already gone (another phone got there first) or isn't this family's.
 */
export async function takeRowOff(householdId: string, itemId: string): Promise<{ row: RemovedRow; name: string } | null> {
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, list: { householdId } },
    select: {
      productId: true,
      quantity: true,
      done: true,
      addedById: true,
      requestedById: true,
      kidPick: true,
      product: { select: { name: true } },
    },
  });
  if (!item) return null;
  // deleteMany, not delete: a second phone deleting it a moment earlier isn't an error.
  const { count } = await prisma.shoppingListItem.deleteMany({ where: { id: itemId, list: { householdId } } });
  if (count === 0) return null;
  const { product, ...row } = item;
  return { row, name: product.name };
}

/**
 * Undo for takeRowOff: the same row back. Skipped when that item is already on the list in
 * the same state (someone re-added it, or Undo was sent twice), so it never doubles up. A
 * person removed from the family in the meantime is simply dropped from the row.
 */
export async function putRowBack(householdId: string, listId: string, row: RemovedRow): Promise<"restored" | "already" | "gone"> {
  const product = await prisma.product.findFirst({ where: { id: row.productId, householdId }, select: { id: true } });
  if (!product) return "gone";
  const already = await prisma.shoppingListItem.findFirst({
    where: { listId, productId: product.id, done: row.done },
    select: { id: true },
  });
  if (already) return "already";

  const wanted = [row.addedById, row.requestedById].filter((id): id is string => id != null);
  const people = wanted.length
    ? await prisma.person.findMany({ where: { id: { in: wanted }, householdId }, select: { id: true } })
    : [];
  const known = new Set(people.map((p) => p.id));
  await prisma.shoppingListItem.create({
    data: {
      listId,
      productId: product.id,
      quantity: row.quantity,
      done: row.done,
      addedById: row.addedById && known.has(row.addedById) ? row.addedById : null,
      requestedById: row.requestedById && known.has(row.requestedById) ? row.requestedById : null,
      kidPick: row.kidPick,
    },
  });
  return "restored";
}

/**
 * The Shop view's offline check-offs. Last op per item wins; ops for rows that no longer
 * exist (another phone finished the trip) are skipped, not errors. All or nothing, so a
 * failed send is simply retried whole. Returns how many rows changed.
 */
export async function applyChecks(householdId: string, ops: { itemId: string; done: boolean }[]): Promise<number> {
  const last = new Map<string, boolean>();
  for (const op of ops) last.set(op.itemId, op.done);
  if (last.size === 0) return 0;
  const results = await prisma.$transaction(
    [...last].map(([id, done]) => prisma.shoppingListItem.updateMany({ where: { id, list: { householdId } }, data: { done } })),
  );
  return results.reduce((n, r) => n + r.count, 0);
}

/**
 * "Not this time": takes a kid's pick off the list and leaves the kid a kind note in their
 * bell. Only rows a kid put there themselves (kidPick), never a med refill that merely names
 * them, and only before it's in the cart. Returns false when there was nothing to veto.
 */
export async function vetoKidPick(householdId: string, itemId: string): Promise<boolean> {
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, list: { householdId }, kidPick: true, done: false },
    select: { id: true, addedById: true, requestedById: true, product: { select: { name: true } } },
  });
  if (!item) return false;
  const kidId = item.addedById ?? item.requestedById;

  await prisma.$transaction(async (tx) => {
    await tx.shoppingListItem.delete({ where: { id: item.id } });
    if (kidId) {
      await notifyPerson(tx, {
        householdId,
        recipientId: kidId,
        kind: "GROCERY_NOT_THIS_TIME",
        title: `Not this time: ${item.product.name}. Maybe next trip!`,
        href: "/groceries",
      });
    }
  });
  return true;
}
