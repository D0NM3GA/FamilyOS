import Link from "next/link";
import type { Forecast } from "@/lib/finance/forecast";
import { formatMoney } from "@/lib/money";
import { sectionTitle } from "@/components/styles";

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const PAY = { WEEKLY: "every week", BIWEEKLY: "every 2 weeks", SEMIMONTHLY: "twice a month", MONTHLY: "every month" } as const;

/** Phase 32: what's safe to spend until payday, and every line it came from. */
export function SafeToSpend({ f, jarId, today }: { f: Forecast; jarId: string; today: string }) {
  if (!f.ready) {
    return (
      <section className="mt-4 rounded-2xl border-2 border-dashed border-ink/25 p-4 dark:border-white/20">
        <h2 className="font-extrabold">💸 Safe to spend</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {f.reason === "NO_ACCOUNTS" ? "Pick your checking account in " : "Your spending accounts have no balance from the bank yet. Check "}
          <Link href={`/finances/${jarId}/settings`} className="font-bold underline">
            Settings
          </Link>
          {f.reason === "NO_ACCOUNTS" ? " and this shows how much is free until payday." : "."}
        </p>
      </section>
    );
  }
  const tight = f.safeCents <= 0;
  return (
    <section className="mt-4 rounded-2xl border-2 border-ink bg-card p-4 dark:border-white/20">
      <h2 className={sectionTitle}>
        💸 Safe to spend {f.payday ? `until payday, ${day(f.payday.nextOn)}` : `for the next ${daysUntil(today, f.until)} days`}
      </h2>
      <p className={`mt-1 text-3xl font-extrabold ${tight ? "text-tomato" : ""}`}>
        {tight ? "$0 (it's tight)" : `about ${formatMoney(f.safeCents)}`}
      </p>
      <p className="mt-1 text-sm">
        Lowest point: about <strong>{formatMoney(f.lowest.cents)}</strong>
        {f.lowest.after ? (
          <>
            {" "}
            on {day(f.lowest.on)}, after {f.lowest.after}
          </>
        ) : (
          " (now)"
        )}
        {f.cushionCents > 0 && <>, keeping {formatMoney(f.cushionCents)} aside</>}.
      </p>
      {!f.payday && (
        <p className="mt-1 text-xs text-muted-foreground">
          No payday found yet, so this looks two weeks ahead. Not seeing your paycheck? Put it in 💵 Income on Activity.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Bank balance as of {when(f.asOf)}. A plan, not a promise: only regular bills (and ✍️ ones added by hand) are counted.</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-3 font-bold sm:py-1">How it&apos;s worked out</summary>
        <ul className="mt-2 flex flex-col divide-y divide-ink/10 dark:divide-white/10">
          <li className="flex justify-between gap-2 py-1">
            <span className="min-w-0 break-words">Now in {f.counted.join(", ")}</span>
            <span className="font-bold">{formatMoney(f.startCents)}</span>
          </li>
          {f.events.map((e, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-1">
              <span>
                <span className="text-muted-foreground">{e.late ? "late, today" : day(e.on)}</span> ·{" "}
                {e.manual && (
                  <span role="img" aria-label="Added by hand: " title="Added by hand">
                    ✍️{" "}
                  </span>
                )}
                {e.label}
                {e.varies && <span className="text-xs text-muted-foreground"> (varies: counting the most it&apos;s been lately)</span>}
              </span>
              <span>
                −{formatMoney(e.cents)} <span className="text-xs text-muted-foreground">→ {formatMoney(e.runningCents)}</span>
              </span>
            </li>
          ))}
          {f.events.length === 0 && <li className="py-1 text-muted-foreground">No regular bills before then.</li>}
          {f.cushionCents > 0 && (
            <li className="flex justify-between gap-2 py-1">
              <span>Cushion</span>
              <span>−{formatMoney(f.cushionCents)}</span>
            </li>
          )}
          {f.payday && (
            <li className="py-1 text-muted-foreground">
              Then payday: {f.payday.label}, {PAY[f.payday.cadence]}.
            </li>
          )}
        </ul>
        {f.notCounted.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Not counted: {f.notCounted.join(", ")}. Card payments count only when they leave checking on a regular rhythm.
          </p>
        )}
      </details>
    </section>
  );
}

function daysUntil(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
