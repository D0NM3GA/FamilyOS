import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { isAdult } from "@/lib/authz";
import { dinnerWords, getMeals, getWeekPlan, ingredientLines, weekFromParam } from "@/lib/groceries/meals";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { toISODate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { ConfirmSubmit } from "@/components/submit";
import { backLink, btn, sectionTitle } from "@/components/styles";
import { addWeekToList, deleteMeal, saveMeal, saveWeek } from "./actions";
import { AddWeekButton, MealForm, WeekForm } from "./meal-forms";

export const metadata: Metadata = { title: "Meals" };

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Phase 65d: a light weekly meal plan (the owner's call): dinner each day, Sunday to Saturday like
 * the calendar, from saved meals or a note, and what the week's meals need onto the list. Grown-ups
 * plan; kids see the week.
 */
export default async function MealsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const adult = isAdult(profile);
  const today = atMidnight(new Date());
  const weekStart = weekFromParam((await searchParams).week, today);
  const [days, meals] = await Promise.all([getWeekPlan(profile.householdId, weekStart), getMeals(profile.householdId)]);
  const weekKey = toISODate(weekStart);
  const step = (n: number) => `/groceries/meals?week=${toISODate(addDays(weekStart, n * 7))}`;
  const thisWeek = weekStart.getTime() === addDays(today, -today.getDay()).getTime();

  return (
    <div className="max-w-3xl p-4 sm:p-6">
      <Link href="/groceries" className={backLink}>
        ← Groceries
      </Link>
      <PageHeader className="mt-1" title="🍽️ Meals" />

      <nav aria-label="Weeks" className="mt-4 flex items-center justify-between gap-2">
        <Link href={step(-1)} className={btn} aria-label="The week before">
          ← Before
        </Link>
        <h2 className="text-center text-lg font-extrabold">
          {thisWeek ? "This week" : `Week of ${dayLabel(weekStart)}`}
        </h2>
        <Link href={step(1)} className={btn} aria-label="The week after">
          After →
        </Link>
      </nav>

      <div className="mt-3">
        {adult ? (
          <div className="flex flex-col gap-3">
            <WeekForm
              key={weekKey}
              action={saveWeek.bind(null, weekKey)}
              meals={meals.map((m) => ({ id: m.id, name: m.name }))}
              days={days.map((d) => ({ label: dayLabel(d.date), mealId: d.mealId, note: d.note, isToday: d.date.getTime() === today.getTime() }))}
            />
            <AddWeekButton key={`add-${weekKey}`} action={addWeekToList.bind(null, weekKey)} />
          </div>
        ) : (
          <ul className="ui-card divide-y-2 divide-dashed divide-ink/10 rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
            {days.map((d) => (
              <li key={d.date.getTime()} className={`flex min-h-11 items-center gap-3 px-3 py-2 ${d.date.getTime() === today.getTime() ? "bg-sun/15" : ""}`}>
                <span className="w-28 shrink-0 font-bold">{dayLabel(d.date)}</span>
                <span className={d.mealName || d.note ? "" : "text-muted-foreground"}>{dinnerWords(d.mealName, d.note) ?? "Not planned yet"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adult && (
        <section className="mt-8">
          <h2 className={sectionTitle}>Saved meals</h2>
          {meals.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Save a meal with its ingredients, then pick it for a day.</p>}
          <ul className="mt-2 space-y-2">
            {meals.map((m) => (
              <li key={m.id} className="ui-card rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2">
                    <span className="font-bold">{m.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {m.ingredients.length ? m.ingredients.map((i) => i.name).join(", ") : "no ingredients"}
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <MealForm action={saveMeal.bind(null, m.id)} name={m.name} ingredients={ingredientLines(m.ingredients)} submitLabel="Save changes" />
                    <form action={deleteMeal.bind(null, m.id)}>
                      <ConfirmSubmit question={`Delete ${m.name}? Days that have it keep its name.`} yes="Delete" className={btn}>
                        Delete<span className="sr-only"> {m.name}</span>
                      </ConfirmSubmit>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="ui-card mt-3 rounded-2xl border-2 border-dashed border-ink/25 p-3 dark:border-white/20">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">+ New meal</summary>
            <div className="mt-3">
              <MealForm action={saveMeal.bind(null, null)} submitLabel="Save meal" />
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
