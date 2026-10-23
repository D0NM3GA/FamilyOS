import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { ensureCategories } from "@/lib/finance/organize";
import { monthRange, parseMonth, shiftMonth, todayCivil } from "@/lib/finance/budget";
import { isHiddenFrom } from "@/lib/finance/gifts";
import { beforeFrom, beforeFromPace, changeFor, lowerLastMonth, paceSoFar, spendingTrend, trendWindow, trimLeading, whereItWent, type Change } from "@/lib/finance/trends";
import { formatMoney } from "@/lib/money";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { btn } from "@/components/styles";
import { JarHeader } from "../jar-header";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Trends" };

const money = (c: number) => formatMoney(c, "USD");
/** "$1.2k" under a bar, where "$1,234.56" won't fit on a phone. */
const short = (c: number) => {
  const d = c / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `$${Math.round(d)}`;
};
const label = (m: string, month: "short" | "long", year = true) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month, ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const pct = (share: number) => `${Math.round(share * 100)}%`;
const monthStep = `${btn} min-w-11 shrink-0 sm:min-w-9`;

/**
 * Phase 33: spending over time. Money out per month for the last year (or the year ending at
 * an older month), and where one month's money went, category by category, with the change
 * from the month before. Every number is the Budget page's for that month (lib/finance/
 * trends.ts): a surprise hidden from the viewer shows only in a month's Surprises line, and
 * nothing here gives it a day. No visibleToWhere on the query, as on Budget: hidden rows must
 * be fetched so they land in that line and the totals stay whole.
 */
export default async function TrendsPage({ params, searchParams }: { params: Promise<{ jarId: string }>; searchParams: Promise<{ month?: string | string[] }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const current = today.slice(0, 7);
  const asked = (await searchParams).month;
  const month = parseMonth(asked, current) ?? current;
  const year = trendWindow(month, current);

  await ensureCategories(prisma, jar.id);
  const from = monthRange(year[0]).gte;
  // One month more than is shown, so the oldest bar still has a month before it to compare with.
  const pre = shiftMonth(year[0], -1);
  const usd = { jarId: jar.id, state: "ACTIVE" as const, account: { currency: "USD" } };
  const [categories, rows, older, foreign] = await Promise.all([
    prisma.finCategory.findMany({
      where: { jarId: jar.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true },
    }),
    prisma.finTransaction.findMany({
      where: { ...usd, postedOn: { gte: monthRange(pre).gte, lt: monthRange(year[year.length - 1]).lt } },
      select: { amountCents: true, postedOn: true, pending: true, categoryId: true, giftHiddenFrom: true, giftRevealOn: true },
    }),
    // Money from before the year shown: then its quiet first months are real, not "before the jar started".
    prisma.finTransaction.findFirst({ where: { ...usd, postedOn: { lt: from } }, select: { id: true } }),
    prisma.finAccount.count({ where: { jarId: jar.id, NOT: { currency: "USD" } } }),
  ]);
  const shaped = rows.map((r) => ({
    amountCents: r.amountCents,
    pending: r.pending,
    categoryId: r.categoryId,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    surprise: isHiddenFrom(r, viewer.id, today),
  }));
  // A surprise hidden from the viewer doesn't decide where the bars start.
  const trim = trimLeading(year, shaped.filter((r) => !r.surprise), month);
  const months = older ? year : trim.months;
  const trend = spendingTrend(shaped, categories, months, today);
  const at = months.indexOf(month);
  const shown = trend.months[at];
  const isCurrent = month === current;
  const prev = shiftMonth(month, -1);

  // The month in progress is compared with the same days of last month; a whole month with the
  // whole month before (in the trend, or the extra month fetched before the oldest bar).
  const hasBefore = at > 0 || older != null;
  const pace = isCurrent && hasBefore ? paceSoFar(shaped, categories, today) : null;
  const before = !hasBefore ? null : pace ? beforeFromPace(pace) : at > 0 ? beforeFrom(trend, at - 1) : beforeFrom(spendingTrend(shaped, categories, [prev], today), 0);
  const prevDays = new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0)).getUTCDate();
  const upTo = Math.min(Number(today.slice(8, 10)), prevDays);
  const comparedWith = !before
    ? null
    : !pace
      ? `Compared with ${label(prev, "long")}`
      : upTo === prevDays
        ? `Compared with all of ${label(prev, "long", false)}`
        : `Compared with ${label(prev, "short", false)} 1${upTo > 1 ? `–${upTo}` : ""}`;

  const slices = whereItWent(trend, at);
  const quiet = trend.categories.filter((t) => t.byMonth[at] === 0);
  const max = Math.max(1, ...trend.months.map((m) => m.outCents));
  const anyUncategorized = trend.months.some((m) => m.uncategorizedOutCents > 0);
  const lower = isCurrent ? lowerLastMonth(trend, current) : null;
  // Where the jar's money starts, when that's inside the year shown.
  const startsAt = !older && trim.first != null && trim.first > year[0] ? trim.first : null;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="trends" />

      {shaped.length === 0 && !older && foreign === 0 ? (
        <div className="mt-6">
          <BunsonMoment kind="chatty" text={MOMENT_LINES.trendsEmpty} />
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            {month > "2000-01" ? (
              <Link href={`/finances/${jar.id}/trends?month=${prev}`} className={monthStep} aria-label="Previous month">
                ←
              </Link>
            ) : (
              <span className="w-11 shrink-0 sm:w-9" />
            )}
            <h2 className="text-center text-2xl font-extrabold">{label(month, "long")}</h2>
            {month < current ? (
              <Link href={`/finances/${jar.id}/trends?month=${shiftMonth(month, 1)}`} className={monthStep} aria-label="Next month">
                →
              </Link>
            ) : (
              <span className="w-11 shrink-0 sm:w-9" />
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
              <div className="text-xs font-bold uppercase text-muted-foreground">Went out</div>
              <div className="text-xl font-extrabold">{money(shown.outCents)}</div>
            </div>
            <div className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
              <div className="text-xs font-bold uppercase text-muted-foreground">Came in</div>
              <div className="text-xl font-extrabold">{money(shown.incomeCents)}</div>
            </div>
          </div>
          {isCurrent && <p className="mt-2 text-sm text-muted-foreground">So far this month.</p>}
          {foreign > 0 && <p className="mt-1 text-xs text-muted-foreground">Only US-dollar accounts are counted here.</p>}

          {lower && (
            <div className="mt-4">
              <BunsonMoment kind="chatty" text={`${lower.name} ${MOMENT_LINES.trendsLower}`} />
            </div>
          )}

          <section className="mt-4 rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
            <h2 className="font-extrabold">Money out, month by month</h2>
            <ol aria-label="Money out by month" className="mt-3 flex h-52 gap-1 pt-4">
              {trend.months.map((m, i) => {
                const selected = m.month === month;
                const h = m.outCents > 0 ? Math.max(2, Math.round((m.outCents / max) * 100)) : 0;
                const loose = m.outCents > 0 ? (m.uncategorizedOutCents / m.outCents) * 100 : 0;
                // On a phone, every other month's name, counting back from the newest.
                const skipLabel = !selected && trend.months.length > 6 && (trend.months.length - 1 - i) % 2 === 1;
                const text = `${label(m.month, "long")}: ${money(m.outCents)} went out`;
                return (
                  <li key={m.month} className="flex min-w-0 flex-1">
                    <Link
                      href={`/finances/${jar.id}/trends?month=${m.month}`}
                      aria-current={selected ? "page" : undefined}
                      aria-label={text}
                      title={text}
                      className="flex w-full flex-col items-center gap-1 rounded-lg px-0.5 pt-1 hover:bg-muted"
                    >
                      <span aria-hidden className="relative w-full flex-1">
                        {selected && (
                          <span className="absolute inset-x-0 text-center text-[10px] font-extrabold leading-4 sm:text-xs" style={{ bottom: `${h}%` }}>
                            {short(m.outCents)}
                          </span>
                        )}
                        <span
                          className={`absolute bottom-0 left-1/2 flex w-full max-w-10 -translate-x-1/2 flex-col overflow-hidden rounded-t-md ${selected ? "" : "ring-1 ring-ink/40 dark:ring-0"}`}
                          style={{ height: `${h}%` }}
                        >
                          <span className="shrink-0 bg-muted-foreground/40" style={{ height: `${loose}%` }} />
                          <span className={`flex-1 ${selected ? "bg-brand-text" : "bg-sky"}`} />
                        </span>
                      </span>
                      <span aria-hidden className={`text-[11px] leading-4 ${selected ? "font-extrabold" : "text-muted-foreground"} ${skipLabel ? "max-sm:invisible" : ""}`}>
                        {label(m.month, "short", false)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span aria-hidden className="inline-block size-2.5 rounded-sm bg-sky ring-1 ring-ink/40 dark:ring-0" /> In a category
              </span>
              {anyUncategorized && (
                <span className="flex items-center gap-1">
                  <span aria-hidden className="inline-block size-2.5 rounded-sm bg-muted-foreground/40" /> Not in a category yet
                </span>
              )}
              <span>Tap a month to see where it went.</span>
            </p>
            {startsAt && month >= startsAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Starts in {label(startsAt, "long")}, when this jar&apos;s money does, so that month may be only part of one.
              </p>
            )}
            {startsAt && month < startsAt && <p className="mt-1 text-xs text-muted-foreground">This jar&apos;s money starts in {label(startsAt, "long")}.</p>}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer py-3.5 text-xs font-bold text-muted-foreground sm:py-1">See the numbers</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-1 pr-2 font-bold">Month</th>
                      <th className="py-1 pr-2 text-right font-bold">Went out</th>
                      <th className="py-1 pr-2 text-right font-bold">Not in a category</th>
                      <th className="py-1 pr-2 text-right font-bold">🎁 Surprises</th>
                      <th className="py-1 text-right font-bold">Came in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.months.map((m) => (
                      <tr key={m.month} className={m.month === month ? "font-extrabold" : ""}>
                        <td className="py-1 pr-2">{label(m.month, "short")}</td>
                        <td className="py-1 pr-2 text-right">{money(m.outCents)}</td>
                        <td className="py-1 pr-2 text-right">{money(m.uncategorizedOutCents)}</td>
                        <td className="py-1 pr-2 text-right">{money(m.surprisesCents)}</td>
                        <td className="py-1 text-right">{money(m.incomeCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <section className="mt-6">
            <h2 className="text-2xl font-extrabold">Where it went</h2>
            {comparedWith && slices.length + quiet.length > 0 && <p className="text-sm text-muted-foreground">{comparedWith}.</p>}
            {slices.length === 0 && <p className="mt-2 text-muted-foreground">Nothing went out in {label(month, "long")}.</p>}
            <ul className="mt-2 flex flex-col gap-2">
              {slices.map((s) => {
                const t = s.kind === "category" ? trend.categories.find((c) => c.category.id === s.category.id) : undefined;
                return (
                  <li key={s.kind === "category" ? s.category.id : s.kind} className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xl" aria-hidden>
                        {s.kind === "category" ? s.category.emoji : s.kind === "surprises" ? "🎁" : "❓"}
                      </span>
                      {s.kind === "surprises" ? (
                        <span className="min-w-0 flex-1 font-extrabold">
                          Surprises <span className="font-normal text-muted-foreground">· {s.count} · no peeking!</span>
                        </span>
                      ) : (
                        <Link
                          href={`/finances/${jar.id}?category=${s.kind === "category" ? s.category.id : "none"}&month=${month}`}
                          className="flex min-h-11 min-w-0 flex-1 items-center font-extrabold break-words hover:underline sm:min-h-9"
                        >
                          {s.kind === "category" ? s.category.name : "Not in a category yet"}
                        </Link>
                      )}
                      <span className="font-bold">
                        {money(s.cents)} <span className="font-normal text-muted-foreground">· {pct(s.share)}</span>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full bg-sky" style={{ width: `${Math.max(1, Math.round(s.share * 100))}%` }} />
                      </div>
                      {t && <Spark values={t.byMonth} at={at} months={months} />}
                    </div>
                    <ChangeNote change={changeFor(s, before)} />
                  </li>
                );
              })}
            </ul>
            {quiet.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {quiet.map((t) => (
                  <li key={t.category.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-0.5 text-sm ring-1 ring-input">
                    <span aria-hidden>{t.category.emoji}</span>
                    <Link
                      href={`/finances/${jar.id}?category=${t.category.id}&month=${month}`}
                      className="flex min-h-11 min-w-0 flex-1 items-center font-bold break-words hover:underline sm:min-h-9"
                    >
                      {t.category.name}
                    </Link>
                    <span className="text-muted-foreground">nothing this month</span>
                    <Spark values={t.byMonth} at={at} months={months} />
                    <ChangeNote change={changeFor({ kind: "quiet", category: t.category }, before)} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              The same numbers as the Budget page: transfers aren&apos;t spending, refunds come off their category in the month they
              arrive, and pending charges count.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** A category's months as tiny bars, read out as a list for screen readers. */
function Spark({ values, at, months }: { values: number[]; at: number; months: string[] }) {
  const top = Math.max(1, ...values);
  return (
    <>
      <span className="sr-only">Month by month: {values.map((v, i) => `${label(months[i], "short")} ${money(v)}`).join(", ")}.</span>
      <span aria-hidden className="flex h-6 w-24 shrink-0 items-end gap-px">
        {values.map((v, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t-sm ${i === at ? "bg-brand-text" : "bg-muted-foreground/45"}`}
            style={{ height: v > 0 ? `${Math.max(8, Math.round((v / top) * 100))}%` : "1px" }}
          />
        ))}
      </span>
    </>
  );
}

function ChangeNote({ change }: { change: Change | null }) {
  if (!change) return null;
  if (change.deltaCents === 0 && change.pct == null) return null;
  if (change.deltaCents === 0)
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        <span aria-hidden>＝ </span>Same as before
      </p>
    );
  const up = change.deltaCents > 0;
  const whole = Math.round(Math.abs(change.pct ?? 0) * 100);
  const by = change.pct == null ? "new" : whole === 0 ? "<1%" : `${up ? "+" : "−"}${whole}%`;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      <span aria-hidden>{up ? "▲" : "▼"} </span>
      <span className="sr-only">{up ? "Up" : "Down"} </span>
      {money(Math.abs(change.deltaCents))} ({by})
    </p>
  );
}
