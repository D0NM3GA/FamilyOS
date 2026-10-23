"use server";

import { redirect, RedirectType } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult } from "@/lib/authz";
import { findOrCreateProductByName, getOrCreateActiveList, productNameKey } from "@/lib/shopping-list";
import { searchProductsLocal } from "@/lib/groceries/queries";
import { normalizeBarcode } from "@/lib/groceries/barcode";
import { lookupBarcode } from "@/lib/groceries/openfoodfacts";
import { lookupWithUpcEFallback } from "@/lib/groceries/off-lookup";
import { guessedSectionId } from "@/lib/groceries/section-edits";
import { CONTAINERS, SIZE_UNITS, describeSize, parseOffQuantity } from "@/lib/groceries/size";
import { mergeProducts } from "@/lib/groceries/merge";
import { addProductToList, applyChecks, putRowBack, takeRowOff, vetoKidPick } from "@/lib/groceries/list";
import { openRemoved, sealRemoved } from "@/lib/groceries/undo";
import { tripSavedHref } from "@/lib/groceries/shop";
import { sheetReturnPath } from "@/lib/groceries/return-to";

function revalidateGroceries() {
  revalidatePath("/groceries");
  revalidatePath("/groceries/pantry");
  revalidatePath("/groceries/shop");
  revalidatePath("/groceries/trips");
}

export async function searchProductsAutocomplete(query: string) {
  const profile = await requireActiveProfile();
  const results = await searchProductsLocal(profile.householdId, String(query).slice(0, 120));
  return results.map((p) => ({
    id: p.id,
    name: p.name,
    detail: [describeSize(p), p.defaultStore?.name].filter(Boolean).join(" · ") || p.brand || null,
  }));
}

/**
 * A brand-new item gets a suggested section from its name; an existing one keeps the family's
 * choice. The guess finds the starting section by its key, whatever the family renamed it to.
 */
async function suggestSection(householdId: string, productId: string, name: string) {
  const groupId = await guessedSectionId(householdId, name);
  if (!groupId) return;
  try {
    await prisma.product.updateMany({ where: { id: productId, householdId, groupId: null }, data: { groupId } });
  } catch (err) {
    // The section was removed (Store sections, another phone) since the guess: no section, then.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003")) throw err;
  }
}

const addInput = z.union([
  z.object({ productId: z.string().min(1) }),
  z.object({ name: z.string().trim().min(1).max(120) }),
]);

/** Adds a Pantry item by id (suggestion, chip) or by typed name, which becomes a Pantry item. */
export async function addItem(input: { productId: string } | { name: string }) {
  const profile = await requireActiveProfile();
  // Chips built from old purchase history can carry a long description; trim, don't drop.
  const parsed = addInput.safeParse("name" in input && typeof input.name === "string" ? { name: input.name.slice(0, 120) } : input);
  if (!parsed.success) return;
  const list = await getOrCreateActiveList(profile.householdId);

  let productId: string;
  if ("productId" in parsed.data) {
    const product = await prisma.product.findFirst({
      where: { id: parsed.data.productId, householdId: profile.householdId },
      select: { id: true },
    });
    if (!product) throw new Error("Item not found");
    productId = product.id;
  } else {
    if (!productNameKey(parsed.data.name)) return;
    const { product, created } = await findOrCreateProductByName(profile.householdId, parsed.data.name);
    if (created) await suggestSection(profile.householdId, product.id, product.name);
    productId = product.id;
  }

  await addProductToList(profile.householdId, list.id, productId, profile);
  revalidateGroceries();
}

export type BarcodeAddResult =
  | { kind: "added"; productName: string; createdProduct: boolean }
  | { kind: "unknown"; barcode: string }
  | { kind: "error"; message: string };

/**
 * Teaches the Pantry a barcode. When an item of that name already exists without a code
 * (typed earlier as "Dog food"), the scan attaches to it rather than making a second "Dog
 * food". If that name is taken by a different barcoded product, the new one gets its brand
 * (or code) appended so both can live in the Pantry.
 */
async function createOrAttachForBarcode(
  householdId: string,
  barcode: string,
  info: { name: string; brand: string | null; imageUrl: string | null; quantity: string | null },
): Promise<{ id: string; name: string; created: boolean }> {
  const size = parseOffQuantity(info.quantity);
  const candidates = [info.name, info.brand ? `${info.name} (${info.brand})` : null, `${info.name} (${barcode})`].filter(
    (n): n is string => Boolean(n),
  );

  for (const name of candidates) {
    const nameKey = productNameKey(name);
    const same = await prisma.product.findUnique({ where: { householdId_nameKey: { householdId, nameKey } } });
    if (same && !same.barcode) {
      const blankSize = same.sizeAmount == null && same.sizeUnit == null;
      const updated = await prisma.product.update({
        where: { id: same.id },
        data: {
          barcode,
          brand: same.brand ?? info.brand,
          imageUrl: same.imageUrl ?? info.imageUrl,
          ...(blankSize && size ? size : {}),
        },
      });
      return { id: updated.id, name: updated.name, created: false };
    }
    if (same) continue;

    try {
      const product = await prisma.product.create({
        data: { householdId, name, nameKey, barcode, brand: info.brand, imageUrl: info.imageUrl, ...(size ?? {}) },
      });
      return { id: product.id, name: product.name, created: true };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      // Someone else (another phone) just taught this barcode, or typed this name: use
      // theirs, attaching the barcode to a typed item as the non-race path above does.
      const byCode = await prisma.product.findFirst({ where: { householdId, barcode } });
      if (byCode) return { id: byCode.id, name: byCode.name, created: false };
      const byName = await prisma.product.findUnique({ where: { householdId_nameKey: { householdId, nameKey } } });
      if (byName && !byName.barcode) {
        const updated = await prisma.product.update({ where: { id: byName.id }, data: { barcode } });
        return { id: updated.id, name: updated.name, created: false };
      }
    }
  }
  throw new Error("Couldn't name that item");
}

/**
 * Adds an item by barcode, from the add box (typed or keyboard-wedge digits) and the camera
 * scanner. Our own Pantry wins outright; else Open Food Facts (food, pet food and household
 * goods), which also fills the size; on a miss with no `name`, "unknown" asks the person to
 * name it once, which adds it AND teaches the Pantry the barcode for next time.
 *
 * NOT idempotent by design (a repeat call increments quantity, like a second tap of "+").
 * The camera scanner debounces client-side (lib/groceries/scan-gate.ts) for exactly this.
 */
export async function addItemByBarcode(rawBarcode: string, name?: string): Promise<BarcodeAddResult> {
  const profile = await requireActiveProfile();
  const typed = normalizeBarcode(rawBarcode);
  if (!typed) return { kind: "error", message: "That doesn't look like a barcode." };

  const list = await getOrCreateActiveList(profile.householdId);

  const existing = await prisma.product.findFirst({
    where: { householdId: profile.householdId, barcode: typed },
  });
  if (existing) {
    await addProductToList(profile.householdId, list.id, existing.id, profile);
    revalidateGroceries();
    return { kind: "added", productName: existing.name, createdProduct: false };
  }

  const offResult = name ? null : await lookupWithUpcEFallback(typed, lookupBarcode);
  const productName = (offResult?.name ?? name?.trim())?.slice(0, 120);
  if (!productName || !productNameKey(productName)) {
    return { kind: "unknown", barcode: typed };
  }

  // Prefer OFF's own canonical code over our derived one when we have it — belt-and-braces
  // on top of normalizeBarcode (itself verified live against OFF's actual rule), since OFF
  // is the ground truth here, not our reimplementation of it.
  const barcode = offResult?.barcode ?? typed;
  if (barcode !== typed) {
    const rechecked = await prisma.product.findFirst({
      where: { householdId: profile.householdId, barcode },
    });
    if (rechecked) {
      await addProductToList(profile.householdId, list.id, rechecked.id, profile);
      revalidateGroceries();
      return { kind: "added", productName: rechecked.name, createdProduct: false };
    }
  }

  const product = await createOrAttachForBarcode(profile.householdId, barcode, {
    name: productName,
    brand: offResult?.brand ?? null,
    imageUrl: offResult?.imageUrl ?? null,
    quantity: offResult?.quantity ?? null,
  });
  if (product.created) await suggestSection(profile.householdId, product.id, product.name);

  await addProductToList(profile.householdId, list.id, product.id, profile);
  revalidateGroceries();
  return { kind: "added", productName: product.name, createdProduct: product.created };
}

async function assertOwnedItem(itemId: string, householdId: string) {
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, list: { householdId } },
  });
  if (!item) throw new Error("Item not found");
  return item;
}

export async function toggleItem(itemId: string, done: boolean) {
  const profile = await requireActiveProfile();
  await assertOwnedItem(itemId, profile.householdId);

  await prisma.shoppingListItem.update({ where: { id: itemId }, data: { done } });
  revalidateGroceries();
}

/** The row's −/+. Down to zero takes it off the list. */
export async function setQuantity(itemId: string, quantity: number) {
  const profile = await requireActiveProfile();
  await assertOwnedItem(itemId, profile.householdId);
  if (!Number.isFinite(quantity)) return;

  const q = Math.min(999, Math.round(quantity * 100) / 100);
  if (q <= 0) await prisma.shoppingListItem.delete({ where: { id: itemId } });
  else await prisma.shoppingListItem.update({ where: { id: itemId }, data: { quantity: q } });
  revalidateGroceries();
}

/** Who an item is FOR, not who added it — e.g. a kid asks an adult to add something. */
export async function setRequestedBy(itemId: string, personId: string | null) {
  const profile = await requireActiveProfile();
  await assertOwnedItem(itemId, profile.householdId);

  if (personId) {
    const person = await prisma.person.findFirst({
      where: { id: personId, householdId: profile.householdId },
    });
    if (!person) throw new Error("Person not found");
  }

  await prisma.shoppingListItem.update({
    where: { id: itemId },
    data: { requestedById: personId },
  });
  revalidateGroceries();
}

/** Snapshots checked-off items into a Purchase and clears them from the list. `saved` is
 * false when there was nothing checked (say another phone already finished the trip). */
export async function completeTrip(): Promise<{ saved: false } | { saved: true; purchaseId: string }> {
  const profile = await requireActiveProfile();
  const list = await getOrCreateActiveList(profile.householdId);

  const doneItems = await prisma.shoppingListItem.findMany({
    where: { listId: list.id, done: true },
    include: { product: { select: { name: true } } },
  });
  if (doneItems.length === 0) return { saved: false };

  const purchaseId = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: { householdId: profile.householdId, listId: list.id, purchasedById: profile.id },
    });

    await tx.purchaseItem.createMany({
      data: doneItems.map((item) => ({
        purchaseId: purchase.id,
        productId: item.productId,
        description: item.product.name,
        quantity: item.quantity,
        requestedById: item.requestedById,
        kidPick: item.kidPick,
      })),
    });

    await tx.shoppingListItem.deleteMany({
      where: { id: { in: doneItems.map((i) => i.id) } },
    });
    return purchase.id;
  });

  revalidateGroceries();
  return { saved: true, purchaseId };
}

/** The /groceries Finish trip form (form actions return nothing), landing where the Shop view does. */
export async function finishTrip() {
  const result = await completeTrip();
  // Replace, as the Shop view does: Back shouldn't bring the finished cart's page back.
  redirect(tripSavedHref(result.saved ? result.purchaseId : null), RedirectType.replace);
}

// ---- Taking a row off, with Undo -------------------------------------------------------

const itemIdInput = z.string().min(1).max(64);
const undoInput = z.string().min(1).max(2048);

/**
 * The row's − at one. Returns a signed Undo token (lib/groceries/undo.ts) and the item's
 * name for the "Took Milk off the list · Undo" bar; null when it was already gone.
 */
export async function takeOffList(itemId: string): Promise<{ undo: string; name: string } | null> {
  const profile = await requireActiveProfile();
  const parsed = itemIdInput.safeParse(itemId);
  if (!parsed.success) return null;
  const removed = await takeRowOff(profile.householdId, parsed.data);
  if (!removed) return null;
  revalidateGroceries();
  return { undo: sealRemoved(removed.row, profile.householdId), name: removed.name };
}

/** Undo: puts the row back exactly as it was. A forged, foreign or stale token does nothing. */
export async function undoTakeOff(token: string): Promise<{ restored: boolean }> {
  const profile = await requireActiveProfile();
  const parsed = undoInput.safeParse(token);
  const row = parsed.success ? openRemoved(parsed.data, profile.householdId) : null;
  if (!row) return { restored: false };
  const list = await getOrCreateActiveList(profile.householdId);
  const outcome = await putRowBack(profile.householdId, list.id, row);
  if (outcome === "restored") revalidateGroceries();
  return { restored: outcome !== "gone" };
}

// ---- Item sheet ------------------------------------------------------------------------

export type SheetState = { error?: string };

/** The list or the Pantry, with the Pantry's chip and search; sheetReturnPath() cleans it. */
export type SheetReturn = string;

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const sheetSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(120),
  brand: z.preprocess(blankToNull, z.string().trim().max(120).nullable()),
  sizeAmount: z.preprocess(
    blankToNull,
    z.coerce.number({ message: "Size must be a number." }).positive("Size must be more than 0.").max(100000).nullable(),
  ),
  sizeUnit: z.preprocess(blankToNull, z.enum(SIZE_UNITS).nullable()),
  container: z.preprocess(blankToNull, z.enum(CONTAINERS).nullable()),
  storeId: z.preprocess(blankToNull, z.string().nullable()),
  newStore: z.preprocess(blankToNull, z.string().trim().max(60).nullable()),
  groupId: z.preprocess(blankToNull, z.string().nullable()),
  barcode: z.preprocess(blankToNull, z.string().trim().max(32).nullable()),
});

async function findOrCreateStore(householdId: string, name: string) {
  const existing = await prisma.store.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  try {
    return (await prisma.store.create({ data: { householdId, name }, select: { id: true } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const race = await prisma.store.findFirst({ where: { householdId, name }, select: { id: true } });
      if (race) return race.id;
    }
    throw err;
  }
}

/** Saves the item sheet. Anyone in the family can fill in details; ids are household-checked. */
export async function saveItemDetails(
  productId: string,
  returnTo: SheetReturn,
  _prev: SheetState,
  formData: FormData,
): Promise<SheetState> {
  const profile = await requireActiveProfile();
  const householdId = profile.householdId;
  const back = sheetReturnPath(returnTo);

  const parsed = sheetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  const d = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: productId, householdId }, select: { id: true } });
  if (!product) return { error: "That item isn't in the Pantry any more." };

  const nameKey = productNameKey(d.name);
  if (!nameKey) return { error: "Give it a name." };
  // A size needs both halves: "31.1" alone or "lb" alone can't be shown.
  if ((d.sizeAmount == null) !== (d.sizeUnit == null)) {
    return { error: d.sizeAmount == null ? "Add the size number too, e.g. 31.1." : "Pick a unit for the size, e.g. lb." };
  }

  let defaultStoreId: string | null = null;
  if (d.newStore) defaultStoreId = await findOrCreateStore(householdId, d.newStore);
  else if (d.storeId) {
    const store = await prisma.store.findFirst({ where: { id: d.storeId, householdId }, select: { id: true } });
    if (!store) return { error: "That store isn't one of yours." };
    defaultStoreId = store.id;
  }

  let groupId: string | null = null;
  if (d.groupId) {
    const group = await prisma.productGroup.findFirst({ where: { id: d.groupId, householdId }, select: { id: true } });
    if (!group) return { error: "That section isn't one of yours." };
    groupId = group.id;
  }

  let barcode: string | null = null;
  if (d.barcode) {
    barcode = normalizeBarcode(d.barcode);
    if (!barcode) return { error: "That barcode doesn't look right." };
  }

  try {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        name: d.name.replace(/\s+/g, " "),
        nameKey,
        brand: d.brand,
        sizeAmount: d.sizeAmount,
        sizeUnit: d.sizeUnit,
        container: d.container,
        defaultStoreId,
        groupId,
        barcode,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String(err.meta?.target ?? "");
      return target.includes("barcode")
        ? { error: "Another Pantry item already has that barcode." }
        : { error: `There's already a “${d.name}” in the Pantry. Use “Same as…” to merge them.` };
    }
    throw err;
  }

  revalidateGroceries();
  // Replace, not push: the phone's Back must not reopen the sheet that was just saved.
  redirect(back, RedirectType.replace);
}

/** "Same as…": folds another Pantry item into this one. Grown-ups only. */
export async function mergeIntoItem(keepId: string, returnTo: SheetReturn, formData: FormData) {
  const profile = await requireAdult();
  const mergeId = String(formData.get("mergeId") ?? "");
  const result = await mergeProducts(profile.householdId, keepId, mergeId);
  revalidateGroceries();
  redirect(sheetReturnPath(returnTo, result.ok ? { item: keepId } : {}), RedirectType.replace);
}

/** Removes an item from the Pantry (and the list). History keeps its name. Grown-ups only. */
export async function deletePantryItem(productId: string, returnTo: SheetReturn) {
  const profile = await requireAdult();
  await prisma.product.deleteMany({ where: { id: productId, householdId: profile.householdId } });
  revalidateGroceries();
  redirect(sheetReturnPath(returnTo), RedirectType.replace);
}

/** Pantry's "+ Add something": makes (or finds) the item and opens its sheet. */
export async function createPantryItem(formData: FormData) {
  const profile = await requireActiveProfile();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!productNameKey(name)) redirect("/groceries/pantry");
  const { product, created } = await findOrCreateProductByName(profile.householdId, name);
  if (created) await suggestSection(profile.householdId, product.id, product.name);
  revalidateGroceries();
  redirect(`/groceries/pantry?item=${product.id}`);
}

// ---- Shop view and kid picks (Phase 23) ------------------------------------------------

const syncOp = z.object({ itemId: z.string().min(1).max(64), done: z.boolean() });
// Distinct items touched in one trip; far above any real list.
const MAX_SYNC_OPS = 1000;

/**
 * The Shop view's offline check-offs, sent when there's signal. Last op per item wins; ops
 * for rows that no longer exist (another phone finished the trip) are skipped, not errors.
 * All or nothing, so a failed send is simply retried whole.
 */
export async function syncChecks(ops: { itemId: string; done: boolean }[]): Promise<{ applied: number }> {
  const profile = await requireActiveProfile();
  // Malformed ops are dropped rather than failing the batch: the batch is all-or-nothing,
  // so one bad stored entry must never make the whole queue unsendable.
  const valid = (Array.isArray(ops) ? ops : []).slice(0, MAX_SYNC_OPS).flatMap((op) => {
    const r = syncOp.safeParse(op);
    return r.success ? [r.data] : [];
  });
  const applied = await applyChecks(profile.householdId, valid);
  if (valid.length > 0) revalidateGroceries();
  return { applied };
}

/**
 * "Not this time": a grown-up takes a kid's pick off the list and the kid gets a kind note
 * in their bell. Only rows a kid put there themselves (kidPick), never a med refill that
 * merely names them, and only before it's in the cart.
 */
export async function vetoItem(itemId: string) {
  const profile = await requireAdult();
  if (await vetoKidPick(profile.householdId, itemId)) revalidateGroceries();
}
