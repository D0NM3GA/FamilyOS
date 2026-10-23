import { prisma, type Tx } from "@/lib/prisma";
import { nameTaken } from "@/lib/list-names";
import { activityWhere } from "./activity";
import { absorbedAfter, isBuiltInCategory, MAX_CATEGORIES, mergeEnvelope, newCategoryKey, type CategoryKind } from "./categories";
import { ensureCategories, lockJarCategories } from "./organize";

/**
 * Phase 37: a jar's categories, renamed, added and removed by its members. Callers have
 * passed requireJar and validated the name and emoji (lib/list-names.ts); everything here is
 * scoped by jar id. One write at a time per jar (the jar's category lock, which the tidy-up
 * takes too), so "names are unique ignoring case", the cap and a removal's moves can't be
 * raced past by two members at once, or land between the tidy-up's read and its write.
 *
 * What points at a category, and what a removal does with each: charges (FinTransaction
 * .categoryId) and "always for this store" rules (CategoryRule.categoryId) move to the
 * target; its budget and saving up merge into the target's (lib/finance/categories.ts
 * mergeEnvelope); its key, and any it had taken in, go on the target's absorbedKeys, so what
 * the app did by key (guessing, Bills, grocery trips) carries on there. Nothing else holds a
 * category: bills added by hand, order emails and surprises hang off charges, and history
 * and sent alerts keep only names or ids as text.
 */

export type CategoryRow = { id: string; key: string; name: string; emoji: string | null; kind: CategoryKind };
type Fail = { ok: false; error: string };
export type CategoryRenamed = { ok: true; from: string; to: string; emoji: string | null; changed: boolean } | Fail;
export type CategoryAdded = { ok: true; name: string; emoji: string | null; kind: "SPEND" | "INCOME" } | Fail;
export type CategoryRemoved = { ok: true; name: string; to: string } | Fail;

const GONE: Fail = { ok: false, error: "That category isn't in this jar anymore. Reload to see the latest." };
const taken = (name: string): Fail => ({ ok: false, error: `This jar already has a category called ${name}.` });

function readCategories(db: Tx | typeof prisma, jarId: string) {
  return db.finCategory.findMany({
    where: { jarId },
    select: {
      id: true,
      key: true,
      absorbedKeys: true,
      name: true,
      emoji: true,
      kind: true,
      sortOrder: true,
      budgetCents: true,
      rollover: true,
      rolloverFrom: true,
      goalCents: true,
      goalMonth: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * The page: every category in order, with how many charges each has that this viewer can
 * see (a surprise for them isn't counted, as on Activity), how many "always" rules point at
 * it, and its budget and saving up (for what the remove question says).
 */
export async function categoriesForEditing(jarId: string, viewerId: string, today: string) {
  await ensureCategories(prisma, jarId);
  const [categories, charges, rules] = await Promise.all([
    readCategories(prisma, jarId),
    prisma.finTransaction.groupBy({ by: ["categoryId"], where: activityWhere(jarId, viewerId, today, { month: null }), _count: { _all: true } }),
    prisma.categoryRule.groupBy({ by: ["categoryId"], where: { jarId }, _count: { _all: true } }),
  ]);
  const chargesOf = new Map(charges.map((c) => [c.categoryId, c._count._all]));
  const rulesOf = new Map(rules.map((r) => [r.categoryId, r._count._all]));
  return categories.map((c) => ({
    ...c,
    builtIn: isBuiltInCategory(c.key),
    charges: chargesOf.get(c.id) ?? 0,
    rules: rulesOf.get(c.id) ?? 0,
  }));
}

export async function renameCategory(jarId: string, id: string, input: { name: string; emoji: string | null }): Promise<CategoryRenamed> {
  return prisma.$transaction(async (tx) => {
    await lockJarCategories(tx, jarId);
    const all = await readCategories(tx, jarId);
    const category = all.find((c) => c.id === id);
    if (!category) return GONE;
    if (nameTaken(input.name, all, category.id)) return taken(input.name);
    const changed = category.name !== input.name || category.emoji !== input.emoji;
    if (changed) await tx.finCategory.update({ where: { id: category.id }, data: { name: input.name, emoji: input.emoji } });
    return { ok: true, from: category.name, to: input.name, emoji: input.emoji, changed };
  });
}

/**
 * A new category: spending goes just before Other (so Other stays last of the spending ones),
 * income just after the jar's last income category. It gets a fresh key (newCategoryKey).
 */
export async function addCategory(jarId: string, input: { name: string; emoji: string | null; kind: "SPEND" | "INCOME" }): Promise<CategoryAdded> {
  await ensureCategories(prisma, jarId);
  return prisma.$transaction(async (tx) => {
    await lockJarCategories(tx, jarId);
    const all = await readCategories(tx, jarId);
    if (all.length >= MAX_CATEGORIES) return { ok: false, error: "That's a lot of categories already. Remove one you don't need first." };
    if (nameTaken(input.name, all)) return taken(input.name);

    const end = all.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
    const lastIncome = all.filter((c) => c.kind === "INCOME").at(-1);
    const at =
      input.kind === "SPEND"
        ? (all.find((c) => c.key === "other")?.sortOrder ?? end)
        : lastIncome
          ? lastIncome.sortOrder + 1
          : (all.find((c) => c.kind === "TRANSFER")?.sortOrder ?? end);
    // A key someone removed lives on in another category's absorbedKeys: never reuse one.
    const used = new Set(all.flatMap((c) => [c.key, ...c.absorbedKeys]));
    let key = newCategoryKey(input.name);
    while (used.has(key)) key = newCategoryKey(input.name);

    await tx.finCategory.updateMany({ where: { jarId, sortOrder: { gte: at } }, data: { sortOrder: { increment: 1 } } });
    await tx.finCategory.create({ data: { jarId, key, name: input.name, emoji: input.emoji, kind: input.kind, sortOrder: at } });
    return { ok: true, name: input.name, emoji: input.emoji, kind: input.kind };
  });
}

/**
 * Removes a category, moving everything that points at it to `targetId` (same kind, same jar)
 * in the same transaction, so nothing is ever left pointing nowhere. Other, Income and
 * Transfers can't be removed.
 *
 * Charges keep how they were set: a guess stays a guess (it now guesses into the target, which
 * took the key), a rule's stays the rule's (the rule moves too), a person's stays theirs.
 */
export async function removeCategory(jarId: string, id: string, targetId: string): Promise<CategoryRemoved> {
  return prisma.$transaction(async (tx) => {
    await lockJarCategories(tx, jarId);
    const all = await readCategories(tx, jarId);
    const category = all.find((c) => c.id === id);
    if (!category) return GONE;
    if (isBuiltInCategory(category.key)) return { ok: false, error: `${category.name} can be renamed but not removed: the app counts on it.` };
    const target = all.find((c) => c.id === targetId);
    if (!target || target.id === category.id || target.kind !== category.kind) {
      return { ok: false, error: "Pick another category of the same kind for its charges." };
    }

    await tx.finTransaction.updateMany({ where: { jarId, categoryId: category.id }, data: { categoryId: target.id } });
    await tx.categoryRule.updateMany({ where: { jarId, categoryId: category.id }, data: { categoryId: target.id } });
    const { budgetCents, rollover, rolloverFrom, goalCents, goalMonth } = mergeEnvelope(target, category);
    await tx.finCategory.update({
      where: { id: target.id },
      data: { budgetCents, rollover, rolloverFrom, goalCents, goalMonth, absorbedKeys: absorbedAfter(target, category) },
    });
    await tx.finCategory.delete({ where: { id: category.id } });
    return { ok: true, name: category.name, to: target.name };
  });
}
