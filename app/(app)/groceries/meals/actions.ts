"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { productNameKey } from "@/lib/product-name";
import { requireAdult } from "@/lib/authz";
import { assertAppOn } from "@/lib/app-guard";
import { findOrCreateProductByName, getOrCreateActiveList, lockList } from "@/lib/shopping-list";
import { DAY_NOTE_MAX, MEAL_NAME_MAX, parseIngredients, weekShopping } from "@/lib/groceries/meals";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { parseLocalDate } from "@/lib/format";
import { guessedSectionId } from "@/lib/groceries/section-edits";

export type MealFormState = { error?: string; ok?: string };

function revalidateMeals() {
  revalidatePath("/groceries/meals");
  revalidatePath("/");
}

const idSchema = z.string().min(1).max(64);

/**
 * Phase 65d: saves a meal (new when `mealId` is null): its name and its ingredients, one per line,
 * each becoming a Pantry item (found or made). Grown-ups plan; kids see the week.
 */
export async function saveMeal(mealId: string | null, _prev: MealFormState, formData: FormData): Promise<MealFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "groceries");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Give the meal a name." };
  if (name.length > MEAL_NAME_MAX) return { error: "That name is too long." };
  const parsed = parseIngredients(String(formData.get("ingredients") ?? ""));
  if (!parsed.ok) return { error: parsed.error };
  if (mealId != null) {
    if (!idSchema.safeParse(mealId).success) return { error: "That meal isn't here anymore." };
    const mine = await prisma.meal.findFirst({ where: { id: mealId, householdId: profile.householdId }, select: { id: true } });
    if (!mine) return { error: "That meal isn't here anymore." };
  }
  // A meal name once per household (two "Tacos" couldn't be told apart in the week's lists).
  const others = await prisma.meal.findMany({ where: { householdId: profile.householdId, ...(mealId ? { NOT: { id: mealId } } : {}) }, select: { name: true } });
  if (others.some((o) => productNameKey(o.name) === productNameKey(name))) return { error: `You already have a meal called ${name}.` };
  // Pantry items first, outside any transaction: their find-or-create survives a race (a failed
  // insert would abort a transaction). One left over from a failed save below is harmless.
  const made: { id: string; name: string }[] = [];
  const byProduct = new Map<string, number>();
  for (const item of parsed.items) {
    const { product, created } = await findOrCreateProductByName(profile.householdId, item.name);
    if (created) made.push(product);
    // Two lines that fold into one Pantry item (say "Egg" and "Eggs") add up.
    byProduct.set(product.id, (byProduct.get(product.id) ?? 0) + item.quantity);
  }
  const ingredients = [...byProduct].map(([productId, quantity]) => ({ productId, quantity }));
  // One write each, nested writes and all, so it's atomic on its own.
  if (mealId == null) {
    await prisma.meal.create({ data: { householdId: profile.householdId, name, ingredients: { create: ingredients } } });
  } else {
    await prisma.meal.update({ where: { id: mealId }, data: { name, ingredients: { deleteMany: {}, create: ingredients } } });
  }
  // New Pantry items get a section guess, as a typed list item does (best effort).
  for (const p of made) {
    const groupId = await guessedSectionId(profile.householdId, p.name).catch(() => null);
    // A section removed since the guess just means no section.
    if (groupId) await prisma.product.updateMany({ where: { id: p.id, groupId: null }, data: { groupId } }).catch(() => {});
  }
  revalidateMeals();
  revalidatePath("/groceries/pantry");
  return { ok: mealId == null ? `${name} saved.` : `${name} updated.` };
}

/** Phase 65d: deletes a saved meal (asks first); days that had it keep its name as their note. */
export async function deleteMeal(mealId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "groceries");
  if (!idSchema.safeParse(mealId).success) return;
  const meal = await prisma.meal.findFirst({ where: { id: mealId, householdId: profile.householdId }, select: { id: true, name: true } });
  if (!meal) return;
  await prisma.$transaction(async (tx) => {
    // Each day keeps the name, ahead of any note it had ("Tacos · at Grandma's").
    const days = await tx.mealPlanDay.findMany({ where: { mealId: meal.id }, select: { id: true, note: true } });
    for (const d of days) {
      await tx.mealPlanDay.update({ where: { id: d.id }, data: { note: (d.note ? `${meal.name} · ${d.note}` : meal.name).slice(0, DAY_NOTE_MAX) } });
    }
    await tx.meal.delete({ where: { id: meal.id } });
  });
  revalidateMeals();
}

/**
 * Phase 65d: saves the shown week's dinners: for each day, a saved meal (checked against the
 * household) or a typed note; a day with neither is cleared.
 */
export async function saveWeek(weekStartRaw: string, _prev: MealFormState, formData: FormData): Promise<MealFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "groceries");
  const weekStart = parseLocalDate(weekStartRaw);
  if (!weekStart || weekStart.getDay() !== 0) return { error: "That week didn't look right. Reload and try again." };
  const meals = new Set((await prisma.meal.findMany({ where: { householdId: profile.householdId }, select: { id: true } })).map((m) => m.id));
  const writes = [];
  for (let i = 0; i < 7; i++) {
    const day = atMidnight(addDays(weekStart, i));
    const rawMeal = String(formData.get(`meal:${i}`) ?? "");
    const mealId = rawMeal && meals.has(rawMeal) ? rawMeal : null;
    if (rawMeal && !mealId) return { error: "One of those meals isn't saved anymore. Reload and pick again." };
    const note = String(formData.get(`note:${i}`) ?? "").trim().replace(/\s+/g, " ").slice(0, DAY_NOTE_MAX) || null;
    const where = { householdId_day: { householdId: profile.householdId, day } };
    writes.push(
      mealId || note
        ? prisma.mealPlanDay.upsert({ where, create: { householdId: profile.householdId, day, mealId, note }, update: { mealId, note } })
        : prisma.mealPlanDay.deleteMany({ where: { householdId: profile.householdId, day } }),
    );
  }
  try {
    await prisma.$transaction(writes);
  } catch (err) {
    // A meal deleted since the check above.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return { error: "One of those meals isn't saved anymore. Reload and pick again." };
    throw err;
  }
  revalidateMeals();
  return { ok: "The week is saved." };
}

/**
 * Phase 65d: puts what the shown week's meals need on the list: each Pantry item once, amounts
 * summed, skipping what's already on it (not ticked off). Says how many went on.
 */
export async function addWeekToList(weekStartRaw: string): Promise<MealFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "groceries");
  const weekStart = parseLocalDate(weekStartRaw);
  if (!weekStart || weekStart.getDay() !== 0) return { error: "That week didn't look right. Reload and try again." };
  const days = await prisma.mealPlanDay.findMany({
    where: { householdId: profile.householdId, day: { gte: weekStart, lt: addDays(weekStart, 7) }, mealId: { not: null } },
    select: { mealId: true, meal: { select: { ingredients: { select: { productId: true, quantity: true } } } } },
  });
  const list = await getOrCreateActiveList(profile.householdId);
  const ingredients = new Map(days.map((d) => [d.mealId!, d.meal?.ingredients ?? []]));
  // Phase 66b: read and added under the list's lock, so an add from another phone in between
  // can't end up as a second row of the same thing.
  const need = await prisma.$transaction(async (tx) => {
    await lockList(tx, list.id);
    const onList = new Set((await tx.shoppingListItem.findMany({ where: { listId: list.id, done: false }, select: { productId: true } })).map((i) => i.productId));
    const missing = weekShopping(days.map((d) => d.mealId), ingredients, onList);
    if (missing.length) await tx.shoppingListItem.createMany({ data: missing.map((n) => ({ listId: list.id, productId: n.productId, quantity: n.quantity, addedById: profile.id })) });
    return missing;
  });
  if (need.length === 0) return { ok: days.length ? "Everything the week's meals need is already on the list." : "No saved meals planned this week." };
  revalidatePath("/groceries");
  revalidatePath("/groceries/shop");
  revalidateMeals();
  return { ok: `Added ${need.length} ${need.length === 1 ? "item" : "items"} to the list.` };
}
