import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { ensureCategories } from "@/lib/finance/organize";
import { budgetMonth, monthRange, parseMonth, shiftMonth, todayCivil } from "@/lib/finance/budget";
import { activityHref } from "@/lib/finance/activity";
import { carryStart, goalPlan, withCarry, type RolloverCategory } from "@/lib/finance/envelope";
import { centsToInput, formatMoney } from "@/lib/money";
import { isHiddenFrom, isUnrevealed } from "@/lib/finance/gifts";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { setBudget, setGoal, setRollover } from "../../actions";
import { ActionForm, Submit } from "../../forms";
import { btn, field } from "@/components/styles";
import { JarHeader } from "../jar-header";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Budget" };

const money = (c: number) => formatMoney(c, "USD");
const signed = (c: number) => (c < 0 ? `−${money(-c)}` : `+${money(c)}`);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthStep = `${btn} min-w-11 shrink-0 sm:min-w-9`;
const BUDGET_ROW = { amountCents: true, postedOn: true, pending: true, categoryId: true, giftHiddenFrom: true, giftRevealOn: true } as const;

/**
 * Phase 26: the jar's month. Spending per category against its monthly number. Months are
 * UTC calendar months (money rows carry UTC civil days). Only US-dollar accounts count.
 * Phase 27: surprises hidden from the viewer count only in one "Surprises" total.
 * Phase 31: saving up. A rollover category carries what earlier months left (or overspent),
 * and can have a goal ("$400 by August") with how much to put aside each month.
 */
export default async function BudgetPage({ params, searchParams }: { params: Promise<{ jarId: string }>; searchParams: Promise<{ month?: string | string[] }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const current = today.slice(0, 7);
  const asked = (await searchParams).month;
  const month = parseMonth(asked, current) ?? current;
  const prev = shiftMonth(month, -1);

  await ensureCategories(prisma, jar.id);
  const categories = await prisma.finCategory.findMany({
    where: { jarId: jar.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true, rollover: true, rolloverFrom: true, goalCents: true, goalMonth: true },
  });
  // Only the rollover categories' earlier months, from the earliest month any of them carries.
  const from = carryStart(categories, month);
  const rolling = categories.filter((c) => c.rollover).map((c) => c.id);
  const [rows, prevRows, foreign, carryRows] = await Promise.all([
    prisma.finTransaction.findMany({
      where: { jarId: jar.id, state: "ACTIVE", postedOn: monthRange(month), account: { currency: "USD" } },
      select: { amountCents: true, postedOn: true, pending: true, categoryId: true, giftHiddenFrom: true, giftRevealOn: true },
    }),
    // Last month only matters for the Bunson note on the current month.
    month === current
      ? prisma.finTransaction.findMany({
          where: { jarId: jar.id, state: "ACTIVE", postedOn: monthRange(prev), account: { currency: "USD" } },
          select: BUDGET_ROW,
        })
      : Promise.resolve([]),
    prisma.finAccount.count({ where: { jarId: jar.id, leftOut: false, NOT: { currency: "USD" } } }),
    from
      ? prisma.finTransaction.findMany({
          where: { jarId: jar.id, state: "ACTIVE", categoryId: { in: rolling }, postedOn: { gte: monthRange(from).gte, lt: monthRange(month).gte }, account: { currency: "USD" } },
          select: BUDGET_ROW,
        })
      : Promise.resolve([]),
  ]);
  const shape = (r: (typeof rows)[number]) => ({
    amountCents: r.amountCents,
    pending: r.pending,
    categoryId: r.categoryId,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    surprise: isHiddenFrom(r, viewer.id, today),
  });
  // Everyone in the jar sees how many surprises are waiting this month (not what they are).
  const marked = rows.filter((r) => isUnrevealed(r, today)).length;
  const cats = withCarry(categories as RolloverCategory[], carryRows.map(shape), month);
  const goalOf = new Map(categories.map((c) => [c.id, c]));
  const summary = budgetMonth(rows.map(shape), cats, month, today);
  const last = budgetMonth(prevRows.map(shape), categories as RolloverCategory[], prev, today);
  const budgeted = summary.lines.filter((l) => l.budgetCents != null);
  // A rollover category's month is judged with its carry, which this note doesn't have.
  const lastUnder = last.lines.find((l) => l.status === "ON_TRACK" && l.spentCents > 0 && !goalOf.get(l.category.id)?.rollover);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="budget" />

      <div className="mt-4 flex items-center justify-between gap-2">
        <Link href={`/finances/${jar.id}/budget?month=${prev}`} className={monthStep} aria-label="Previous month">
          ←
        </Link>
        <h2 className="text-center text-2xl font-extrabold">{label}</h2>
        {month < current ? (
          <Link href={`/finances/${jar.id}/budget?month=${shiftMonth(month, 1)}`} className={monthStep} aria-label="Next month">
            →
          </Link>
        ) : (
          <span className="w-11 shrink-0 sm:w-9" />
        )}
      </div>

      {/* Three across even on a phone, so the totals shrink and may wrap instead of pushing the page sideways. */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border-2 border-ink bg-card p-2 sm:p-3 dark:border-white/20">
          <div className="text-xs font-bold uppercase text-muted-foreground">Spent</div>
          <div className="text-base font-extrabold [overflow-wrap:anywhere] sm:text-xl">{money(summary.spentCents)}</div>
        </div>
        <div className="rounded-2xl border-2 border-ink bg-card p-2 sm:p-3 dark:border-white/20">
          <div className="text-xs font-bold uppercase text-muted-foreground">Budgeted</div>
          <div className="text-base font-extrabold [overflow-wrap:anywhere] sm:text-xl">{money(summary.budgetedCents)}</div>
        </div>
        <div className="rounded-2xl border-2 border-ink bg-card p-2 sm:p-3 dark:border-white/20">
          <div className="text-xs font-bold uppercase text-muted-foreground">Income</div>
          <div className="text-base font-extrabold [overflow-wrap:anywhere] sm:text-xl">{money(summary.incomeCents)}</div>
        </div>
      </div>
      {month === current && <p className="mt-2 text-sm text-muted-foreground">{Math.round(summary.monthGone * 100)}% of the month gone.</p>}
      {summary.uncategorizedOutCents > 0 && (
        <p className="mt-1 text-sm">
          <Link href={activityHref(jar.id, { category: "none", month })} className="inline-flex min-h-11 items-center font-bold underline sm:min-h-0">
            {money(summary.uncategorizedOutCents)} not in a category yet
          </Link>
        </p>
      )}
      {foreign > 0 && <p className="mt-1 text-xs text-muted-foreground">Only US-dollar accounts are counted here.</p>}
      {month !== current && (
        <p className="mt-1 text-sm text-muted-foreground">
          Budgets are the same every month, so they&apos;re changed on{" "}
          <Link href={`/finances/${jar.id}/budget`} className="inline-flex min-h-11 items-center font-bold underline sm:min-h-0">
            {monthName(current)}
          </Link>
          .
        </p>
      )}
      {summary.surpriseCount > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink/30 bg-card p-3 dark:border-white/20">
          <span className="text-xl" aria-hidden>
            🎁
          </span>
          <span className="min-w-0 flex-1 font-extrabold">
            Surprises <span className="font-normal text-muted-foreground">· {summary.surpriseCount} · no peeking!</span>
          </span>
          <span className="font-bold">{money(summary.surprisesCents)}</span>
        </div>
      )}
      {marked > 0 && marked !== summary.surpriseCount && (
        <p className="mt-1 text-xs text-muted-foreground">
          🎁 {marked} surprise{marked === 1 ? "" : "s"} marked this month.
        </p>
      )}

      <div className="mt-4">
        {budgeted.length === 0 ? (
          <BunsonMoment kind="chatty" text={MOMENT_LINES.budgetStart} />
        ) : lastUnder && month === current ? (
          <BunsonMoment kind="chatty" text={`${lastUnder.category.name} ${MOMENT_LINES.budgetUnder}`} />
        ) : null}
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {summary.lines.map((l) => {
          const cap = l.availableCents ?? l.budgetCents;
          const pct = cap == null ? 0 : cap > 0 ? Math.min(100, Math.round((l.spentCents / cap) * 100)) : 100;
          const c = goalOf.get(l.category.id)!;
          const balance = l.availableCents != null ? l.availableCents - l.spentCents : null;
          const plan = c.goalCents && c.goalMonth && balance != null ? goalPlan(c.goalCents, c.goalMonth, balance, month) : null;
          return (
            <li key={l.category.id} className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl" aria-hidden>
                  {l.category.emoji}
                </span>
                <Link
                  href={activityHref(jar.id, { category: l.category.id, month })}
                  className="flex min-h-11 min-w-0 flex-1 items-center font-extrabold break-words hover:underline sm:min-h-9"
                >
                  {l.category.name}
                </Link>
                <span className="font-bold">
                  {money(l.spentCents)}
                  {l.budgetCents != null && <span className="font-normal text-muted-foreground"> of {money(l.budgetCents)}</span>}
                </span>
                {l.status === "OVER" && <span className="rounded-md bg-tomato/20 px-1.5 text-xs font-bold">Over</span>}
                {l.status === "ON_TRACK" && <span className="rounded-md bg-lime/40 px-1.5 text-xs font-bold text-ink">On track</span>}
              </div>
              {l.budgetCents != null && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% of budget`}>
                  <div className={`h-full ${l.status === "OVER" ? "bg-tomato" : "bg-lime"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
              {l.pendingCents > 0 && <p className="mt-1 text-xs text-muted-foreground">incl. {money(l.pendingCents)} pending</p>}
              {l.carryInCents != null && l.availableCents != null && balance != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  🐷 {signed(l.carryInCents)} carried in · {money(l.availableCents)} to spend this month ·{" "}
                  <span className={balance < 0 ? "font-bold text-tomato" : "font-bold text-foreground"}>{balance < 0 ? `${money(-balance)} short` : `${money(balance)} left`}</span>
                </p>
              )}
              {plan && c.goalCents && c.goalMonth && balance != null && (
                <div className="mt-2 rounded-xl bg-muted/50 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">
                      🎯 {money(c.goalCents)} by {monthName(c.goalMonth)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {plan.reached
                        ? "🎉 Goal reached!"
                        : plan.past
                          ? `It was needed by ${monthName(c.goalMonth)}: ${money(plan.remainingCents)} to go`
                          : plan.monthsAfter === 0
                            ? `${money(plan.remainingCents)} to go this month`
                            : `Put aside about ${money(plan.perMonthCents)} a month after this one${l.budgetCents != null && plan.perMonthCents > l.budgetCents ? " (more than the monthly budget)" : ""}`}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.max(0, Math.min(100, Math.round((balance / c.goalCents) * 100)))}% of the goal`}>
                    <div className="h-full bg-sky" style={{ width: `${Math.max(0, Math.min(100, Math.round((balance / c.goalCents) * 100)))}%` }} />
                  </div>
                </div>
              )}
              {month === current && (
                <ActionForm action={setBudget.bind(null, jar.id, l.category.id)} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">
                    <span className="text-muted-foreground">Monthly $</span>
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={centsToInput(l.budgetCents)}
                      placeholder="none"
                      aria-label={`Monthly budget for ${l.category.name}`}
                      className={`${field} w-24`}
                    />
                  </label>
                  <Submit className={btn}>Set</Submit>
                </ActionForm>
              )}
              {l.budgetCents != null && month === current && (
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer py-3.5 text-xs font-bold text-muted-foreground sm:py-1">🐷 Saving up{c.rollover ? ": on" : ""}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Leftovers roll into next month, and overspending comes out of it, so a lumpy cost (school fees, car registration,
                      birthdays) has money waiting. It uses this monthly budget for every month, so changing the budget changes what&apos;s
                      carried. Turning it off forgets the carry.
                    </p>
                    <ActionForm action={setRollover.bind(null, jar.id, l.category.id, !c.rollover)} className="flex flex-col gap-1">
                      <Submit className={`${btn} self-start`}>{c.rollover ? "Stop rolling over" : "🐷 Roll leftovers into next month"}</Submit>
                    </ActionForm>
                    <ActionForm action={setGoal.bind(null, jar.id, l.category.id)} className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span className="text-muted-foreground">Need $</span>
                        <input
                          name="goal"
                          inputMode="decimal"
                          defaultValue={centsToInput(c.goalCents)}
                          placeholder="amount"
                          aria-label={`Goal for ${l.category.name}`}
                          className={`${field} w-24`}
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-muted-foreground">by</span>
                        <input name="by" type="month" min={current} defaultValue={c.goalMonth ?? ""} aria-label={`Goal month for ${l.category.name}`} className={field} />
                      </label>
                      <Submit className={btn}>Set goal</Submit>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
