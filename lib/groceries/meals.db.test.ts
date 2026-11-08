import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getTodaysDinner, getWeekPlan, mealWeekStart } from "./meals";

/**
 * Phase 65d against a real database (`npm run test:db`): a grown-up saves a meal (its ingredients
 * become Pantry items), plans the week, and puts what's missing on the list once; deleting a meal
 * leaves its name on the days; a kid can't plan; today's dinner reads back for Home.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("meal plan (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", ivy: "" };
  const week = mealWeekStart(new Date());
  const weekKey = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-meals-${t}` } });
    const [dad, ivy] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } }),
    ]);
    Object.assign(ids, { h: h.id, dad: dad.id, ivy: ivy.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const as = async (id: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
  };
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.append(k, v);
    return f;
  };

  test("save a meal, plan the week, add what's missing once, delete keeps the name", async () => {
    const { saveMeal, saveWeek, addWeekToList, deleteMeal } = await import("@/app/(app)/groceries/meals/actions");
    await as(ids.dad);
    expect(await saveMeal(null, {}, form({ name: "Tacos", ingredients: "Tortillas\n2 Tomatoes" }))).toEqual({ ok: "Tacos saved." });
    const meal = await prisma.meal.findFirstOrThrow({ where: { householdId: ids.h }, include: { ingredients: { include: { product: true } } } });
    expect(meal.ingredients.map((i) => [i.product.name, i.quantity]).sort()).toEqual([["Tomatoes", 2], ["Tortillas", 1]]);

    const todayIndex = new Date().getDay();
    const otherIndex = (todayIndex + 1) % 7;
    // The same name again is refused; editing renames and replaces the ingredients.
    expect(await saveMeal(null, {}, form({ name: "tacos" }))).toEqual({ error: "You already have a meal called tacos." });
    expect(await saveMeal(meal.id, {}, form({ name: "Tacos", ingredients: "Tortillas\n2 Tomatoes\nLimes" }))).toEqual({ ok: "Tacos updated." });
    await saveMeal(meal.id, {}, form({ name: "Tacos", ingredients: "Tortillas\n2 Tomatoes" }));

    expect(await saveWeek(weekKey, {}, form({ [`meal:${todayIndex}`]: meal.id, [`note:${todayIndex}`]: "early", [`meal:${otherIndex}`]: meal.id, [`note:${(todayIndex + 2) % 7}`]: "Out" }))).toEqual({ ok: "The week is saved." });
    expect(await saveWeek(weekKey, {}, form({ "meal:0": "not-a-meal" }))).toEqual({ error: "One of those meals isn't saved anymore. Reload and pick again." });
    expect(await getTodaysDinner(ids.h)).toBe("Tacos · early");

    expect(await addWeekToList(weekKey)).toEqual({ ok: "Added 2 items to the list." });
    const rows = await prisma.shoppingListItem.findMany({ where: { list: { householdId: ids.h } }, include: { product: true } });
    // Phase 69b: only today on counts, so on a Saturday the "other" day (Sunday) is already past.
    const days = otherIndex > todayIndex ? 2 : 1;
    expect(rows.map((r) => [r.product.name, r.quantity]).sort()).toEqual([["Tomatoes", 2 * days], ["Tortillas", days]]);
    expect(await addWeekToList(weekKey)).toEqual({ ok: "Everything the rest of the week's meals need is on the list (or always in the house)." });

    // Phase 69b: a ticked row counts as on the list, and "We always have it" is never added.
    await prisma.shoppingListItem.updateMany({ where: { list: { householdId: ids.h } }, data: { done: true } });
    expect(await addWeekToList(weekKey)).toMatchObject({ ok: expect.stringMatching(/^Everything/) });
    await prisma.shoppingListItem.deleteMany({ where: { list: { householdId: ids.h } } });
    await prisma.product.updateMany({ where: { householdId: ids.h, name: "Tortillas" }, data: { alwaysHave: true } });
    expect(await addWeekToList(weekKey)).toEqual({ ok: "Added 1 item to the list." });
    expect((await prisma.shoppingListItem.findMany({ where: { list: { householdId: ids.h } }, include: { product: true } })).map((r) => r.product.name)).toEqual(["Tomatoes"]);

    await deleteMeal(meal.id);
    const plan = await getWeekPlan(ids.h, week);
    expect(plan[todayIndex]).toMatchObject({ mealId: null, note: "Tacos · early" });
    expect(plan[otherIndex]).toMatchObject({ mealId: null, note: "Tacos" });
    expect(plan[(todayIndex + 2) % 7].note).toBe("Out");
    expect(plan.filter((d) => d.mealId || d.note)).toHaveLength(3);
  });

  test("a kid can't plan", async () => {
    const { saveMeal, saveWeek } = await import("@/app/(app)/groceries/meals/actions");
    await as(ids.ivy);
    await expect(saveMeal(null, {}, form({ name: "Ice cream" }))).rejects.toThrow("Only adults");
    await expect(saveWeek(weekKey, {}, form({ "note:0": "Pizza" }))).rejects.toThrow("Only adults");
  });
});
