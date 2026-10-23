import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { shiftMonth, todayCivil } from "@/lib/finance/budget";
import { readBalanceDays, readHoldings, type HoldingRow } from "@/lib/finance/holdings";
import {
  accountNow,
  accountStale,
  ageWords,
  EARLIEST_VALUE_DAY,
  HOLDING_KIND,
  HOLDING_KINDS,
  holdingStale,
  isOwed,
  netWorthMonths,
  worthWindow,
  type WorthMonth,
} from "@/lib/finance/net-worth";
import { centsToInput, formatMoney } from "@/lib/money";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { btn, btnDanger, btnPrimary, card, field, fieldLabel, sectionTitle } from "@/components/styles";
import { addHolding, removeHolding, removeHoldingValue, valueHolding } from "../../actions";
import { ActionForm, ConfirmSubmit, Submit } from "../../forms";
import { JarHeader } from "../jar-header";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Net worth" };

const money = (c: number) => formatMoney(c, "USD");
/** "$412k" above a bar, where "$412,345.67" won't fit on a phone. */
const short = (c: number) => {
  const d = Math.abs(c) / 100;
  const text = d >= 1_000_000 ? `$${(d / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${Math.round(d)}`;
  return c < 0 ? `-${text}` : text;
};
const label = (m: string, month: "short" | "long", year = true) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month, ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const quiet = "inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-bold text-muted-foreground underline hover:bg-muted sm:min-h-9";

/**
 * Phase 34: what the jar has minus what it owes (lib/finance/net-worth.ts), now and at each
 * month's end for a year. Bank balances come from the feed (one per synced day, from the day
 * this shipped on); the house, cars and loans the feed can't see are valued here by hand, with
 * a nudge when a value gets old. Balances are already visible to every member (Activity,
 * Settings, Safe to spend), and nothing here is ever a surprise.
 */
export default async function NetWorthPage({ params }: { params: Promise<{ jarId: string }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar } = await requireJar(jarId);
  const today = todayCivil();
  const current = today.slice(0, 7);
  const months = worthWindow(today);

  const [accounts, holdings] = await Promise.all([
    prisma.finAccount.findMany({
      where: { jarId: jar.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, org: true, source: true, currency: true, balanceCents: true, balanceAt: true },
    }),
    readHoldings(prisma, jar.id),
  ]);
  const usd = accounts.filter((a) => a.currency === "USD");
  const foreign = accounts.length - usd.length;
  const days = await readBalanceDays(prisma, usd.map((a) => a.id), `${months[0]}-01`);
  const known = usd.map((a) => ({ ...a, ...accountNow(a.balanceCents, a.balanceAt ? dayOf(a.balanceAt) : null, days.get(a.id) ?? []) }));
  // Statement files don't carry a balance; the feed's accounts do.
  const noBalance = known.filter((a) => a.cents == null).length;
  const series = netWorthMonths(
    known.map((a) => ({ id: a.id, nowCents: a.cents, days: days.get(a.id) ?? [] })),
    holdings,
    months,
    today,
  );
  const now = series.at(-1)?.month === current ? series.at(-1)! : null;
  const bars = series.filter((m) => m.month > months[0]);
  // Only against a whole month: one missing an account counted now would show its balance as a gain.
  const lastMonth = series.find((m) => m.month === shiftMonth(current, -1) && !m.partial);
  const yearAgo = series.find((m) => m.month === months[0] && !m.partial);

  const counted = known.filter((a) => a.cents != null);
  const asOf = counted.flatMap((a) => (a.seen ? [a.seen] : [])).sort()[0];
  const accountRows = counted.map((a) => ({ ...a, cents: a.cents!, stale: accountStale(a.seen, today) }));
  const owned = holdings.filter((h) => !isOwed(h.kind));
  const loans = holdings.filter((h) => isOwed(h.kind));

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="net-worth" />

      {!now ? (
        <div className="mt-6">
          <BunsonMoment kind="chatty" text={MOMENT_LINES.worthEmpty} />
        </div>
      ) : (
        <>
          <section className={`mt-4 text-center ${card}`}>
            <div className={sectionTitle}>Net worth</div>
            <div className={`text-4xl font-extrabold ${now.netCents < 0 ? "text-tomato" : ""}`}>{money(now.netCents)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {money(now.haveCents)} we have, minus {money(now.oweCents)} we owe
              {asOf && <> · bank balances as of {day(asOf)}</>}
            </div>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-bold">
              {lastMonth && <Change label={`since the end of ${label(lastMonth.month, "long", false)}`} cents={now.netCents - lastMonth.netCents} />}
              {yearAgo && <Change label="since a year ago" cents={now.netCents - yearAgo.netCents} />}
            </ul>
          </section>

          {lastMonth && now.netCents > lastMonth.netCents && (
            <div className="mt-4">
              <BunsonMoment kind="chatty" text={MOMENT_LINES.worthUp} />
            </div>
          )}

          <Bars bars={bars} />
        </>
      )}
      {foreign > 0 && <p className="mt-1 text-xs text-muted-foreground">Only US-dollar accounts are counted here.</p>}
      {noBalance > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {noBalance === 1 ? "One account has" : `${noBalance} accounts have`} no balance (statement files don&apos;t carry one), so{" "}
          {noBalance === 1 ? "it isn't" : "they aren't"} counted. Add one below as something you own if it should be.
        </p>
      )}

      <section className="mt-6">
        <h2 className={sectionTitle}>💰 What we have</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {accountRows
            .filter((a) => a.cents >= 0)
            .map((a) => (
              <AccountRow key={a.id} jarId={jar.id} account={a} cents={a.cents} />
            ))}
          {owned.map((h) => (
            <HoldingCard key={h.id} jarId={jar.id} holding={h} today={today} />
          ))}
        </ul>
        {accountRows.every((a) => a.cents < 0) && owned.length === 0 && <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>}
      </section>

      <section className="mt-6">
        <h2 className={sectionTitle}>🧾 What we owe</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {accountRows
            .filter((a) => a.cents < 0)
            .map((a) => (
              <AccountRow key={a.id} jarId={jar.id} account={a} cents={-a.cents} />
            ))}
          {loans.map((h) => (
            <HoldingCard key={h.id} jarId={jar.id} holding={h} today={today} />
          ))}
        </ul>
        {accountRows.every((a) => a.cents >= 0) && loans.length === 0 && (
          <p className="mt-1 text-sm text-muted-foreground">{accountRows.length + holdings.length > 0 ? "Nothing owed. 🎉" : "Nothing yet."}</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className={sectionTitle}>✍️ Things the bank feed can&apos;t see</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The house, the cars, a loan at another bank. Type in what each is worth today (or on the day you know); update it every so often and
          I&apos;ll nudge you when one gets old.
        </p>
        <details className="mt-2">
          <summary className={`${btnPrimary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>+ Add something we own or owe</summary>
          <ActionForm action={addHolding.bind(null, jar.id)} className={`mt-2 flex flex-col gap-3 ${card}`} resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>What is it?</span>
                <select name="kind" required defaultValue="HOME" className={field}>
                  {HOLDING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {HOLDING_KIND[k].emoji} {HOLDING_KIND[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Name</span>
                <input name="name" required maxLength={60} placeholder="Our house" className={field} />
              </label>
              <ValueFields today={today} valueLabel="Worth, or owed for a loan ($)" />
            </div>
            <Submit className={`${btnPrimary} self-start`}>Add it</Submit>
          </ActionForm>
        </details>
      </section>
    </div>
  );
}

function Change({ label, cents }: { label: string; cents: number }) {
  const [arrow, words] = cents > 0 ? ["↑", "Up"] : cents < 0 ? ["↓", "Down"] : ["→", "No change,"];
  return (
    <li>
      <span aria-hidden>{arrow}</span>
      <span className="sr-only">{words}</span> {money(Math.abs(cents))} <span className="font-normal text-muted-foreground">{label}</span>
    </li>
  );
}

/**
 * Month-end net worth for up to a year, one bar each, the current month as of today. Bars grow
 * up from a zero line, at the bottom unless a month is below zero, then in the middle.
 */
function Bars({ bars }: { bars: WorthMonth[] }) {
  const anyNegative = bars.some((m) => m.netCents < 0);
  const max = Math.max(1, ...bars.map((m) => Math.abs(m.netCents)));
  const span = anyNegative ? 50 : 100;
  return (
    <section className={`mt-4 ${card} p-3`}>
      <h2 className="font-extrabold">Month by month</h2>
      <ol aria-label="Net worth at each month's end" className="mt-3 flex h-52 gap-1 pt-4">
        {bars.map((m, i) => {
          const latest = i === bars.length - 1;
          const h = m.netCents === 0 ? 0 : Math.max(2, Math.round((Math.abs(m.netCents) / max) * span));
          const below = m.netCents < 0;
          const skipLabel = !latest && bars.length > 6 && (bars.length - 1 - i) % 2 === 1;
          return (
            <li key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5">
              <span className="sr-only">
                {label(m.month, "long")}
                {latest ? " (so far)" : ""}: {money(m.netCents)}
                {m.partial ? " (missing some bank balances)" : ""}
              </span>
              <span aria-hidden className="relative w-full flex-1">
                {anyNegative && <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-muted-foreground/50" />}
                {latest && (
                  <span
                    className="absolute inset-x-0 text-center text-[10px] font-extrabold leading-4 sm:text-xs"
                    style={{ bottom: below ? "50%" : `${(anyNegative ? 50 : 0) + h}%` }}
                  >
                    {short(m.netCents)}
                  </span>
                )}
                <span
                  className={`absolute left-1/2 w-full max-w-10 -translate-x-1/2 ${below ? "rounded-b-md bg-tomato/70" : `rounded-t-md ${latest ? "bg-brand-text" : "bg-sky"}`} ${latest ? "" : "ring-1 ring-ink/40 dark:ring-0"} ${m.partial ? "opacity-40" : ""}`}
                  style={below ? { top: "50%", height: `${h}%` } : { bottom: anyNegative ? "50%" : 0, height: `${h}%` }}
                  title={`${label(m.month, "long")}: ${money(m.netCents)}`}
                />
              </span>
              <span aria-hidden className={`text-[11px] leading-4 ${latest ? "font-extrabold" : "text-muted-foreground"} ${skipLabel ? "max-sm:invisible" : ""}`}>
                {label(m.month, "short", false)}
              </span>
            </li>
          );
        })}
      </ol>
      {bars.some((m) => m.partial) ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Paler bars are missing some bank balances: they&apos;re kept from the day the bank feed first syncs after Net worth arrived (or an
          account joined), so those months fill in from then on. Things typed in count their first value back to the start.
        </p>
      ) : (
        bars.length < 12 && <p className="mt-2 text-xs text-muted-foreground">Starts in {label(bars[0].month, "long")}, the first month with anything in it.</p>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-3.5 text-xs font-bold text-muted-foreground sm:py-1">See the numbers</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-bold">Month&apos;s end</th>
                <th className="py-1 pr-2 text-right font-bold">Have</th>
                <th className="py-1 pr-2 text-right font-bold">Owe</th>
                <th className="py-1 text-right font-bold">Net worth</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((m, i) => (
                <tr key={m.month} className={i === bars.length - 1 ? "font-extrabold" : ""}>
                  <td className="py-1 pr-2">
                    {label(m.month, "short")}
                    {i === bars.length - 1 ? " (so far)" : ""}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(m.haveCents)}</td>
                  <td className="py-1 pr-2 text-right">{money(m.oweCents)}</td>
                  <td className="py-1 text-right">{money(m.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** A bank-feed account: its balance (always shown positive, on the side its sign put it). */
function AccountRow({
  jarId,
  account,
  cents,
}: {
  jarId: string;
  account: { name: string; org: string | null; source: "SIMPLEFIN" | "MANUAL"; seen: string | null; stale: number | null };
  cents: number;
}) {
  return (
    <li className="rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-extrabold break-words">🏦 {account.name}</span>
        <span className="font-bold">{money(cents)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {account.org ? `${account.org} · ` : ""}
        {account.source === "SIMPLEFIN" ? "bank feed" : "statement file"}
        {account.seen ? ` · as of ${day(account.seen)}` : ""}
      </p>
      {account.stale != null && (
        <p className="mt-1 text-sm font-semibold">
          🕰️ Last updated {ageWords(account.stale)}.{" "}
          <Link href={`/finances/${jarId}/settings`} className="underline">
            Is the bank feed still connected?
          </Link>
        </p>
      )}
    </li>
  );
}

/** A thing valued by hand: its newest value, a nudge when that's old, and Update / past values / Remove. */
function HoldingCard({ jarId, holding, today }: { jarId: string; holding: HoldingRow; today: string }) {
  const kind = HOLDING_KIND[holding.kind];
  // Always one (the last value can't be taken off); a holding without any still shows, to fix or remove.
  const latest = holding.values.at(-1) ?? null;
  const stale = latest ? holdingStale(holding.kind, latest.day, today) : null;
  const past = [...holding.values].reverse();
  return (
    <li className="flex flex-col gap-1 rounded-2xl border-2 border-dashed border-ink/40 bg-card p-3 dark:border-white/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-extrabold break-words">
          {kind.emoji} {holding.name}
        </span>
        <span className="font-bold">{latest ? money(latest.cents) : "No value yet"}</span>
      </div>
      {latest && (
        <p className="text-xs text-muted-foreground">
          ✍️ {isOwed(holding.kind) ? "owed" : "worth"} as of {day(latest.day)}
        </p>
      )}
      {stale != null && <p className="text-sm font-semibold">🕰️ Valued {ageWords(stale)}. Still right?</p>}
      <details>
        <summary className={`${quiet} cursor-pointer`}>Update</summary>
        <ActionForm action={valueHolding.bind(null, jarId, holding.id)} className="mt-2 flex flex-col gap-3" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <ValueFields today={today} cents={latest?.cents} valueLabel={isOwed(holding.kind) ? "How much is owed ($)" : "What it's worth ($)"} />
          </div>
          <Submit className={`${btn} self-start`}>Save</Submit>
        </ActionForm>
        {past.length > 1 && (
          <div className="mt-3">
            <div className={fieldLabel}>Values so far</div>
            <ul className="mt-1 flex flex-col text-sm">
              {past.map((v) => (
                <li key={v.day} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {day(v.day)}: {money(v.cents)}
                  </span>
                  <ActionForm action={removeHoldingValue.bind(null, jarId, holding.id, v.day)} className="flex flex-col">
                    <ConfirmSubmit
                      question={`Take off the value from ${day(v.day)}? You can enter it again.`}
                      yes="Take off"
                      aria-label={`Take off the value from ${day(v.day)}`}
                      className={quiet}
                      yesClassName={btnDanger}
                    >
                      Take off
                    </ConfirmSubmit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ActionForm action={removeHolding.bind(null, jarId, holding.id)} className="mt-3 flex flex-col gap-2">
          <ConfirmSubmit
            question={`Remove ${holding.name}? It comes out of every month, past ones too. Sold it? Update its value to 0 instead.`}
            yes="Yes, remove it"
          >
            Remove
          </ConfirmSubmit>
        </ActionForm>
      </details>
    </li>
  );
}

/** Value and "as of" day, for adding and for updating. */
function ValueFields({ today, cents, valueLabel }: { today: string; cents?: number; valueLabel: string }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>{valueLabel}</span>
        <input name="value" required inputMode="decimal" maxLength={20} defaultValue={centsToInput(cents)} placeholder="350000" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>As of</span>
        <input name="valuedOn" type="date" required defaultValue={today} min={EARLIEST_VALUE_DAY} max={today} className={field} />
      </label>
    </>
  );
}
