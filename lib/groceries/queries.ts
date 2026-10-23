import { prisma } from "@/lib/prisma";
import { computePantrySuggestions, type PurchaseHistoryRow } from "./pantry";
import { STARTING_SECTIONS } from "./sections";
import { usualFor, type Usual } from "./usual";
import { rankKidTiles } from "./shop";

// getOrCreateActiveList moved to the kernel lib/shopping-list.ts — Meds' refill hook needs
// it too, and app/(app)/meds/** may not import @/lib/groceries/* per eslint.config.mjs's
// domain-boundary rule. Import it from there directly; it's not re-exported from here.

/**
 * Seeds the starting sections the first time a household touches groceries. Only when it
 * has none at all: a section the family renamed or deleted must not come back (which is why
 * the Store sections page keeps at least one). Each keeps its starting key for guessing.
 */
export async function ensureStartingSections(householdId: string) {
  const existing = await prisma.productGroup.count({ where: { householdId } });
  if (existing > 0) return;

  await prisma.productGroup.createMany({
    data: STARTING_SECTIONS.map((s, i) => ({ householdId, name: s.name, emoji: s.emoji, sortOrder: i, starterKey: s.key })),
    skipDuplicates: true,
  });
}

export async function getSections(householdId: string) {
  return prisma.productGroup.findMany({
    where: { householdId },
    select: { id: true, name: true, emoji: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getStores(householdId: string) {
  return prisma.store.findMany({ where: { householdId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

const productForList = {
  select: {
    id: true,
    name: true,
    brand: true,
    imageUrl: true,
    sizeAmount: true,
    sizeUnit: true,
    container: true,
    defaultStore: { select: { name: true } },
    group: { select: { name: true, emoji: true, sortOrder: true } },
  },
} as const;

export async function getListItems(listId: string) {
  return prisma.shoppingListItem.findMany({
    where: { listId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      done: true,
      requestedById: true,
      kidPick: true,
      createdAt: true,
      product: productForList,
      requestedBy: { select: { id: true, firstName: true } },
    },
    orderBy: [{ done: "asc" }, { createdAt: "asc" }],
  });
}

/** The minimal shape groupItemsByStore actually reads — generic over this (like
 * lib/tasks/queries.ts's bucketInstances) rather than pinned to getListItems' concrete
 * Prisma return type, so it's testable with plain fixture objects. */
type GroupableItem = {
  done: boolean;
  product: { name: string; defaultStore: { name: string } | null; group: { sortOrder: number; name: string } | null };
};

export const NO_STORE = "Anywhere";

/**
 * Groups items by their product's store ("which trip"; items with no store land in
 * "Anywhere", last), then orders each store's items the way you walk it: section order,
 * then name. Unchecked items stay before checked ones within a store; items with no section
 * come after every section within their done-tier.
 */
export function groupItemsByStore<T extends GroupableItem>(items: T[]): { storeName: string; items: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const storeName = item.product.defaultStore?.name ?? NO_STORE;
    if (!groups.has(storeName)) groups.set(storeName, []);
    groups.get(storeName)!.push(item);
  }

  return [...groups.entries()]
    .sort((a, b) => (a[0] === NO_STORE ? 1 : b[0] === NO_STORE ? -1 : a[0].localeCompare(b[0])))
    .map(([storeName, groupItems]) => ({
      storeName,
      items: [...groupItems].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const orderA = a.product.group?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.product.group?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.product.name.localeCompare(b.product.name);
      }),
    }));
}

type SectionedItem = { product: { group: { name: string; emoji?: string | null } | null } };

/**
 * One store's items (already in walk order from groupItemsByStore) split under section
 * headings for the printed list: sections in the order they're first met, so the paper
 * follows the Shop view's aisle order, and items with no section stay last. Items keep
 * their order within a section.
 */
export function groupBySection<T extends SectionedItem>(items: T[]): { section: { name: string; emoji: string | null } | null; items: T[] }[] {
  const groups = new Map<string | null, { section: { name: string; emoji: string | null } | null; items: T[] }>();
  for (const item of items) {
    const group = item.product.group;
    const key = group?.name ?? null;
    if (!groups.has(key)) groups.set(key, { section: group ? { name: group.name, emoji: group.emoji ?? null } : null, items: [] });
    groups.get(key)!.items.push(item);
  }
  const unsectioned = groups.get(null);
  groups.delete(null);
  return unsectioned ? [...groups.values(), unsectioned] : [...groups.values()];
}

/**
 * Add-box typeahead: names starting with what was typed come first, then names containing
 * it anywhere. Local only, no external calls.
 */
export async function searchProductsLocal(householdId: string, query: string, limit = 6) {
  const term = query.trim();
  if (!term) return [];

  const select = {
    id: true,
    name: true,
    brand: true,
    sizeAmount: true,
    sizeUnit: true,
    container: true,
    defaultStore: { select: { name: true } },
  } as const;
  const starts = await prisma.product.findMany({
    where: { householdId, name: { startsWith: term, mode: "insensitive" } },
    select,
    orderBy: { name: "asc" },
    take: limit,
  });
  if (starts.length >= limit) return starts;

  const rest = await prisma.product.findMany({
    where: {
      householdId,
      name: { contains: term, mode: "insensitive" },
      id: { notIn: starts.map((p) => p.id) },
    },
    select,
    orderBy: { name: "asc" },
    take: limit - starts.length,
  });
  return [...starts, ...rest];
}

/** Most recently purchased distinct items, for one-tap re-adding. */
export async function getRecentlyBought(householdId: string, limit = 8) {
  const recent = await prisma.purchaseItem.findMany({
    where: { purchase: { householdId } },
    orderBy: { purchase: { purchasedAt: "desc" } },
    take: 40,
    select: { description: true, productId: true },
  });

  const seen = new Set<string>();
  const result: { description: string; productId: string | null }[] = [];
  for (const item of recent) {
    const key = item.productId ?? item.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

const PANTRY_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Which purchased items are "probably due" again, based on cadence — see
 * lib/groceries/pantry.ts's computePantrySuggestions for the actual math (this just fetches
 * and shapes the history). Bounded to the last year so the read stays cheap as
 * purchase_item grows; narrowed `select`, no Person data crosses through here at all.
 */
export async function getPantrySuggestions(
  householdId: string,
  opts: { excludeKeys?: Set<string>; limit?: number } = {},
) {
  const since = new Date(Date.now() - PANTRY_LOOKBACK_MS);
  const rows = await prisma.purchaseItem.findMany({
    where: { purchase: { householdId, purchasedAt: { gte: since } } },
    select: { productId: true, description: true, purchase: { select: { purchasedAt: true } } },
    orderBy: { purchase: { purchasedAt: "desc" } },
  });

  const history: PurchaseHistoryRow[] = rows.map((r) => ({
    key: r.productId ?? r.description.toLowerCase(),
    label: r.description,
    productId: r.productId,
    purchasedAt: r.purchase.purchasedAt,
  }));

  return computePantrySuggestions(history, new Date(), opts);
}

/** "Usually" for each of these products, learned from the last year's trips. */
export async function getUsuals(householdId: string, productIds?: string[]): Promise<Map<string, Usual>> {
  const since = new Date(Date.now() - PANTRY_LOOKBACK_MS);
  const rows = await prisma.purchaseItem.findMany({
    where: {
      purchase: { householdId, purchasedAt: { gte: since } },
      productId: productIds ? { in: productIds } : { not: null },
    },
    select: { productId: true, quantity: true, purchase: { select: { purchasedAt: true } } },
  });

  const byProduct = new Map<string, { quantity: number; purchasedAt: Date }[]>();
  for (const r of rows) {
    if (!r.productId) continue;
    const list = byProduct.get(r.productId) ?? [];
    list.push({ quantity: r.quantity, purchasedAt: r.purchase.purchasedAt });
    byProduct.set(r.productId, list);
  }

  const usuals = new Map<string, Usual>();
  for (const [id, history] of byProduct) {
    const u = usualFor(history);
    if (u) usuals.set(id, u);
  }
  return usuals;
}

/**
 * A kid's picture tiles (Phase 23): what they picked themselves before, then the family's
 * recent buys, skipping what's already waiting on the list. Only kid picks count as "theirs",
 * so a medicine refill tagged for them never shows up as a snack tile.
 */
export async function getKidTiles(householdId: string, kidId: string, onList: Set<string>) {
  const [picks, recent] = await Promise.all([
    prisma.purchaseItem.findMany({
      where: { purchase: { householdId }, kidPick: true, requestedById: kidId, productId: { not: null } },
      select: { productId: true },
      orderBy: { purchase: { purchasedAt: "desc" } },
      take: 200,
    }),
    getRecentlyBought(householdId, 24),
  ]);
  const ids = rankKidTiles({
    kidPicks: picks.map((p) => p.productId!),
    recent: recent.map((r) => r.productId).filter((id): id is string => id != null),
    onList,
  });
  if (ids.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { householdId, id: { in: ids } },
    select: { id: true, name: true, imageUrl: true, group: { select: { emoji: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    return p ? [{ id: p.id, name: p.name, imageUrl: p.imageUrl, emoji: p.group?.emoji ?? "🛒" }] : [];
  });
}

/**
 * The Pantry search box's words: each one must match the name or the brand, so "purina dog"
 * finds "Dog food · Purina". Capped so a pasted paragraph can't become a huge query.
 */
export function pantrySearchTerms(query: string | null | undefined): string[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words.map((w) => w.slice(0, 40)))].slice(0, 5);
}

/** The whole Pantry (or what matches the search box), for its tidy-up page. */
export async function getPantryItems(householdId: string, search?: string | null) {
  const terms = pantrySearchTerms(search);
  return prisma.product.findMany({
    where: {
      householdId,
      AND: terms.map((t) => ({
        OR: [{ name: { contains: t, mode: "insensitive" as const } }, { brand: { contains: t, mode: "insensitive" as const } }],
      })),
    },
    select: { ...productForList.select, barcode: true, groupId: true, defaultStoreId: true },
    orderBy: { name: "asc" },
  });
}

/** One item for the item sheet, household-scoped: a foreign or stale id reads as "no sheet". */
export async function getItemForSheet(householdId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, householdId },
    select: {
      ...productForList.select,
      barcode: true,
      groupId: true,
      defaultStoreId: true,
      updatedAt: true,
    },
  });
}
