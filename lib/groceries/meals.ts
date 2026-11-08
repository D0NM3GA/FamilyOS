import { prisma } from "@/lib/prisma";
import { productNameKey } from "@/lib/product-name";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { parseLocalDate } from "@/lib/format";

/**
 * Phase 65d: a light weekly meal plan (the owner's call): a dinner a day, from saved meals or a
 * typed note, and one tap to put what the week's meals need on the list.
 */
export const MEAL_NAME_MAX = 80;
export const DAY_NOTE_MAX = 120;
export const INGREDIENTS_MAX = 40;

/** The week a day falls in, Sunday to Saturday like the calendar (lib/calendar/agenda.ts weekStartOf). */
export function mealWeekStart(d: Date): Date {
  const day = atMidnight(d);
  return addDays(day, -day.getDay());
}

/** "YYYY-MM-DD" -> that week's Sunday, or this week's for anything else (and no further than ten years). */
export function weekFromParam(raw: string | undefined, today: Date): Date {
  // parseLocalDate refuses a day that doesn't exist (2026-02-31) rather than rolling it over.
  const d = raw ? parseLocalDate(raw) : null;
  if (d && Math.abs(d.getTime() - today.getTime()) < 3650 * 86_400_000) return mealWeekStart(d);
  return mealWeekStart(today);
}

/** A weight or volume after the number: that's a recipe amount, not how many to buy (one package). */
const UNITS = new Set(["lb", "lbs", "oz", "g", "kg", "cup", "cups", "tsp", "tbsp", "ml", "l"]);

/**
 * The ingredient lines of a meal, one per line: "Tortillas", "2 Tomatoes", "2x Limes" (a number and a
 * space first is how many to buy). A name that starts with a digit stays whole ("2% milk", "7-Up");
 * a weight or volume ("12 oz pasta") is one of the rest ("pasta"). Same items fold together; blank
 * lines are dropped. Pure.
 */
export function parseIngredients(text: string): { ok: true; items: { name: string; quantity: number }[] } | { ok: false; error: string } {
  const byKey = new Map<string, { name: string; quantity: number }>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > INGREDIENTS_MAX) return { ok: false, error: `At most ${INGREDIENTS_MAX} ingredients.` };
  for (const line of lines) {
    const m = /^(\d+(?:\.\d+)?)(?:\s*x)?\s+(.+)$/i.exec(line);
    let quantity = m ? Number(m[1]) : 1;
    let name = (m ? m[2] : line).trim().replace(/\s+/g, " ");
    const [first, ...rest] = name.split(" ");
    if (m && rest.length && UNITS.has(first.toLowerCase().replace(/\.$/, ""))) {
      quantity = 1;
      name = rest.join(" ");
    }
    if (name.length > 120) return { ok: false, error: "One of those ingredients is too long." };
    if (!(quantity > 0) || quantity > 999) return { ok: false, error: `Check the amount for ${name}.` };
    const key = productNameKey(name);
    if (!key) continue;
    const had = byKey.get(key);
    if (had) had.quantity += quantity;
    else byKey.set(key, { name, quantity });
  }
  return { ok: true, items: [...byKey.values()] };
}

/** A meal's ingredients back as the lines it was typed as. */
export function ingredientLines(items: { name: string; quantity: number }[]): string {
  // "1 x 7-Up": a name that starts with a digit keeps its count, so a re-save reads it back the same.
  return items.map((i) => (i.quantity === 1 && !/^\d/.test(i.name) ? i.name : `${i.quantity} x ${i.name}`)).join("\n");
}

/**
 * What the week's meals need that isn't on the list (not ticked off): each Pantry item once, its
 * amounts summed across the week. Pure.
 */
export function weekShopping(
  mealIds: (string | null)[],
  ingredients: Map<string, { productId: string; quantity: number }[]>,
  onList: Set<string>,
): { productId: string; quantity: number }[] {
  const need = new Map<string, number>();
  for (const mealId of mealIds) {
    if (!mealId) continue;
    for (const i of ingredients.get(mealId) ?? []) {
      if (onList.has(i.productId)) continue;
      need.set(i.productId, (need.get(i.productId) ?? 0) + i.quantity);
    }
  }
  return [...need].map(([productId, quantity]) => ({ productId, quantity }));
}

/** "Tacos · at Grandma's", "Tacos", "Leftovers", or null. */
export function dinnerWords(mealName: string | null, note: string | null): string | null {
  return [mealName, note].filter(Boolean).join(" · ") || null;
}

export type PlanDay = { date: Date; mealId: string | null; mealName: string | null; note: string | null };

/** The week's seven days with their dinners. */
export async function getWeekPlan(householdId: string, weekStart: Date): Promise<PlanDay[]> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rows = await prisma.mealPlanDay.findMany({
    where: { householdId, day: { gte: days[0], lt: addDays(days[0], 7) } },
    select: { day: true, mealId: true, note: true, meal: { select: { name: true } } },
  });
  const byDay = new Map(rows.map((r) => [atMidnight(r.day).getTime(), r]));
  return days.map((date) => {
    const r = byDay.get(date.getTime());
    return { date, mealId: r?.mealId ?? null, mealName: r?.meal?.name ?? null, note: r?.note ?? null };
  });
}

/** Saved meals, by name, with their ingredients. */
export async function getMeals(householdId: string) {
  const meals = await prisma.meal.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, ingredients: { select: { productId: true, quantity: true, product: { select: { name: true } } }, orderBy: { product: { name: "asc" } } } },
  });
  return meals.map((m) => ({ id: m.id, name: m.name, ingredients: m.ingredients.map((i) => ({ productId: i.productId, name: i.product.name, quantity: i.quantity })) }));
}

/** Today's dinner in words ("Tacos", "Leftovers"), or null: Home's Today strip. */
export async function getTodaysDinner(householdId: string, now: Date = new Date()): Promise<string | null> {
  const row = await prisma.mealPlanDay.findUnique({
    where: { householdId_day: { householdId, day: atMidnight(now) } },
    select: { note: true, meal: { select: { name: true } } },
  });
  return dinnerWords(row?.meal?.name ?? null, row?.note ?? null);
}
