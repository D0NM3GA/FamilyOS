import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { ensureCategories } from "@/lib/finance/organize";
import { todayCivil } from "@/lib/finance/budget";
import { parseYear } from "@/lib/finance/year";
import { loadYear } from "@/lib/finance/year-load";
import { formatMoney } from "@/lib/money";
import { btn } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { JarHeader } from "../../jar-header";

export const metadata: Metadata = { title: "The year" };

const money = (c: number) => formatMoney(c, "USD");

/**
 * Phase 70e: a calendar year of the jar in one page, for taxes: spending by category, what isn't
 * filed yet, surprises as a total, and income, with a spreadsheet (each category's months too).
 */
export default async function YearPage({ params, searchParams }: { params: Promise<{ jarId: string }>; searchParams: Promise<{ year?: string | string[] }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const year = parseYear((await searchParams).year, today);
  const thisYear = Number(today.slice(0, 4));
  await ensureCategories(prisma, jar.id);
  const s = await loadYear(jar.id, viewer.id, year, today);

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="trends" />
      <Link href={`/finances/${jar.id}/trends`} className={`${btn} mt-4`}>
        ← Trends
      </Link>
      <nav aria-label="Years" className="mt-4 flex items-center justify-between gap-2">
        {year > 2000 ? (
          <Link href={`/finances/${jar.id}/trends/year?year=${year - 1}`} className={btn} aria-label={`Previous year: ${year - 1}`}>
            ← {year - 1}
          </Link>
        ) : (
          <span />
        )}
        <h1 className="text-center text-2xl font-extrabold">
          {year}
          {year === thisYear && <span className="block text-sm font-normal text-muted-foreground">so far</span>}
        </h1>
        {year < thisYear ? (
          <Link href={`/finances/${jar.id}/trends/year?year=${year + 1}`} className={btn} aria-label={`Next year: ${year + 1}`}>
            {year + 1} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="ui-card rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
          <dt className="text-xs font-bold text-muted-foreground">Spent</dt>
          <dd className="text-xl font-extrabold">{money(s.spentCents + s.uncategorizedOutCents)}</dd>
        </div>
        <div className="ui-card rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
          <dt className="text-xs font-bold text-muted-foreground">Income</dt>
          <dd className="text-xl font-extrabold">{money(s.incomeCents)}</dd>
        </div>
      </dl>

      {s.lines.length === 0 && s.uncategorizedOutCents === 0 && s.surprisesCents === 0 ? (
        <p className="mt-6 text-muted-foreground">Nothing spent in {year} in this jar.</p>
      ) : (
        <ul className="ui-card mt-4 divide-y-2 divide-dashed divide-ink/10 rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
          {s.lines.map((l) => (
            <li key={l.category.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 break-words font-bold">
                {l.category.emoji} {l.category.name}
              </span>
              <span className="shrink-0">{money(l.spentCents)}</span>
            </li>
          ))}
          {s.uncategorizedOutCents > 0 && (
            <li className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-muted-foreground">
              <span>Not in a category</span>
              <span>{money(s.uncategorizedOutCents)}</span>
            </li>
          )}
          {s.surprisesCents > 0 && (
            <li className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-muted-foreground">
              <span>🎁 Surprises</span>
              <span>{money(s.surprisesCents)}</span>
            </li>
          )}
        </ul>
      )}

      {/* A download, posted like the jar's other spreadsheet: it's noted in the jar's history. */}
      <form method="post" action={`/finances/${jar.id}/trends/year/export`} className="mt-4">
        <input type="hidden" name="year" value={year} />
        <button type="submit" className={btn}>
          ⬇️ {year} as a spreadsheet
        </button>
      </form>
    </div>
  );
}
