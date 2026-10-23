import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { findRecurring, daysBetween, paidCheck, RECURRING_WINDOW_DAYS, type Recurring } from "@/lib/finance/recurring";
import { todayCivil } from "@/lib/finance/budget";
import { centsToInput, formatMoney } from "@/lib/money";
import { visibleToWhere } from "@/lib/finance/gifts";
import { forecast } from "@/lib/finance/forecast";
import { BILL_CADENCES, billsAhead, CADENCE_LABEL, nextDueOn, ownKeys, readManualBills, type ManualBillInput } from "@/lib/finance/manual-bills";
import { addManualBill, markRecurring, removeManualBill, updateManualBill } from "../../actions";
import { ActionForm, ConfirmSubmit, Submit } from "../../forms";
import { JarHeader } from "../jar-header";
import { SafeToSpend } from "../safe-to-spend";
import { btn, btnPrimary, field, fieldLabel, sectionTitle } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export const metadata: Metadata = { title: "Bills & ahead" };

const REVIEW_EVERY_DAYS = 90;
const quiet = "inline-flex min-h-11 items-center rounded-xl px-2 text-xs text-muted-foreground underline hover:bg-muted sm:min-h-9";
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const CADENCE = { WEEKLY: "every week", BIWEEKLY: "every 2 weeks", MONTHLY: "every month", QUARTERLY: "every 3 months", YEARLY: "every year" } as const;

/**
 * Phase 26: bills and subscriptions, found from the jar's own charges (lib/finance/recurring.ts).
 * "Still using this?" comes back every 90 days for subscriptions; answers are per merchant.
 * Phase 27: quarterly and yearly bills; surprises hidden from the viewer aren't counted.
 * Phase 31: Coming up looks 30 days ahead with about how much it adds up to (regular bills
 * only: weekly shops aren't bills), and a settled price change is flagged.
 * Phase 32: Safe to spend until payday, from the same rows (lib/finance/forecast.ts).
 * Bills added by hand (lib/finance/manual-bills.ts) for what charges can't show (checks, yearly
 * fees): in Coming up and Safe to spend with a ✍️, and a found bill one stands for is counted once.
 */
export default async function BillsPage({ params, searchParams }: { params: Promise<{ jarId: string }>; searchParams: Promise<{ hidden?: string }> }) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const showHidden = (await searchParams).hidden === "1";
  const today = todayCivil();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - RECURRING_WINDOW_DAYS * 86_400_000);

  const [rows, marks, accounts, settings, manual] = await Promise.all([
    prisma.finTransaction.findMany({
      where: {
        jarId: jar.id,
        state: "ACTIVE",
        postedOn: { gte: since },
        account: { currency: "USD" },
        AND: [
          // Money in only matters on spending accounts (paydays).
          { OR: [{ amountCents: { lt: 0 } }, { amountCents: { gt: 0 }, account: { spending: true } }] },
          visibleToWhere(viewer.id, today),
        ],
      },
      orderBy: { postedOn: "asc" },
      select: {
        merchantKey: true,
        merchantName: true,
        payee: true,
        description: true,
        postedOn: true,
        amountCents: true,
        privacyCardMemo: true,
        pending: true,
        accountId: true,
        category: { select: { key: true, absorbedKeys: true, kind: true } },
        privacyCharges: { select: { cardToken: true }, take: 1 },
      },
    }),
    prisma.recurringMark.findMany({ where: { jarId: jar.id }, select: { key: true, status: true, reviewedAt: true } }),
    prisma.finAccount.findMany({
      where: { jarId: jar.id, currency: "USD" },
      select: { id: true, name: true, spending: true, balanceCents: true, availableCents: true, balanceAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.moneyJar.findUniqueOrThrow({ where: { id: jar.id }, select: { cushionCents: true } }),
    readManualBills(prisma, jar.id),
  ]);
  const shaped = rows.map((r) => ({
    key: r.merchantKey === "-" ? "" : r.merchantKey,
    label: r.merchantName ?? r.payee ?? r.description,
    postedOn: r.postedOn.toISOString().slice(0, 10),
    amountCents: r.amountCents,
    privacyCardToken: r.privacyCharges[0]?.cardToken ?? null,
    privacyCardMemo: r.privacyCardMemo,
    category: r.category,
    pending: r.pending,
    accountId: r.accountId,
  }));
  const found = findRecurring(shaped, today);
  const statusOf = new Map(marks.map((m) => [m.key, m.status]));
  const safe = forecast({ accounts, rows: shaped, statusOf, today, cushionCents: settings.cushionCents, manualBills: manual });
  const markOf = new Map(marks.map((m) => [m.key, m]));
  const hidden = found.filter((f) => markOf.get(f.key)?.status === "HIDDEN");
  const visible = found.filter((f) => markOf.get(f.key)?.status !== "HIDDEN");
  const paid = paidCheck(shaped, new Set(found.map((f) => f.key)), today);
  const soon = billsAhead(found, manual, statusOf, today, 30, paid);
  // Found bills a hand-added one stands for: said on their card, so it's clear why they aren't counted.
  const countedAs = new Map(manual.flatMap((b) => ownKeys(b, found).map((k) => [k, b.name] as const)));
  const choices = [...new Map(visible.map((f) => [f.key, f.label])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const subs = visible.filter((f) => f.isSubscription);
  const others = visible.filter((f) => !f.isSubscription);

  const card = (f: Recurring) => {
    const mark = markOf.get(f.key);
    const stopped = f.stopped;
    const ask = f.isSubscription && !stopped && mark?.status !== "CANCEL" && (!mark || daysBetween(mark.reviewedAt.toISOString().slice(0, 10), today) > REVIEW_EVERY_DAYS);
    return (
      <li key={f.key} className="flex flex-col gap-1 rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 font-extrabold break-words">
            {f.cardMemo && "🔒 "}
            {f.label}
          </span>
          <span className="font-bold">
            {f.steady ? "" : "about "}
            {formatMoney(f.typicalCents)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {f.cadence ? CADENCE[f.cadence] : "Privacy.com card"} · last {day(f.lastOn)}
          {f.nextOn && !stopped && <> · {f.nextOn < today ? "expected" : "next about"} {day(f.nextOn)}</>}
          {stopped && <> · may have stopped</>}
          {!f.steady && <> · amount varies</>}
        </p>
        {countedAs.has(f.key) && <p className="text-xs font-bold">✍️ Counted as {countedAs.get(f.key)}, added by hand, so it isn&apos;t counted twice.</p>}
        {f.priceChange && (
          <p className={`text-xs font-bold ${f.priceChange.toCents > f.priceChange.fromCents ? "text-tomato" : ""}`}>
            {f.priceChange.toCents > f.priceChange.fromCents ? "📈 Went up" : "📉 Went down"} from {formatMoney(f.priceChange.fromCents)} to{" "}
            {formatMoney(f.priceChange.toCents)} on {day(f.priceChange.sinceOn)}
          </p>
        )}
        {mark?.status === "CANCEL" && (
          <div className="flex flex-wrap items-center gap-x-1 text-sm font-bold break-words text-tomato">
            <span className="min-w-0">
              🛑 Cancel at {f.label}
              {stopped && " (looks done)"}
            </span>
            <form action={markRecurring.bind(null, jar.id, f.key, "CLEAR")}>
              <SubmitButton className="inline-flex min-h-11 items-center px-1 text-xs font-normal underline sm:min-h-9">
                undo
              </SubmitButton>
            </form>
          </div>
        )}
        {ask && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">Still using this?</span>
            <form action={markRecurring.bind(null, jar.id, f.key, "KEEP")}>
              <SubmitButton className={btn}>
                Yes, keep it
              </SubmitButton>
            </form>
            <form action={markRecurring.bind(null, jar.id, f.key, "CANCEL")}>
              <SubmitButton className={btn}>
                Cancel it
              </SubmitButton>
            </form>
          </div>
        )}
        <form action={markRecurring.bind(null, jar.id, f.key, "HIDDEN")} className="self-end">
          <SubmitButton className={quiet}>
            Not a bill
          </SubmitButton>
        </form>
      </li>
    );
  };

  const section = (title: string, list: Recurring[], empty: string) => (
    <section className="mt-5">
      <h2 className={sectionTitle}>{title}</h2>
      {list.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{empty}</p> : <ul className="mt-2 flex flex-col gap-2">{list.map(card)}</ul>}
    </section>
  );

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="bills" />
      <SafeToSpend f={safe} jarId={jar.id} today={today} />
      <p className="mt-3 text-sm text-muted-foreground">
        Found from the jar&apos;s own charges: anything that comes back every week, two weeks, month, three months or year, plus every
        Privacy.com card. The bank feed only goes back about three months, so for yearly bills import older statements in Settings, or
        add the bill by hand below.
      </p>

      <section className="mt-5">
        <h2 className={sectionTitle}>Coming up (next 30 days)</h2>
        {soon.items.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No regular bills due in the next 30 days.</p>
        ) : (
          <>
            <p className="mt-1 text-sm">
              About <strong>{formatMoney(soon.totalCents)}</strong> in {soon.items.length} bill{soon.items.length === 1 ? "" : "s"}.
            </p>
            <ul className="mt-2 flex flex-col divide-y divide-ink/10 rounded-2xl border-2 border-ink bg-card px-3 dark:divide-white/10 dark:border-white/20">
              {soon.items.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="w-16 shrink-0 font-bold text-muted-foreground">{f.nextOn < today ? "late" : day(f.nextOn)}</span>
                  <span className="min-w-0 flex-1 font-bold break-words">
                    {f.manualId && (
                      <span role="img" aria-label="Added by hand: " title="Added by hand">
                        ✍️{" "}
                      </span>
                    )}
                    {f.cardMemo && "🔒 "}
                    {f.label}
                    {f.cancelling && <span className="ml-1 text-xs text-tomato">🛑 meant to cancel</span>}
                  </span>
                  <span className="font-bold">
                    {f.steady ? "" : "about "}
                    {formatMoney(f.typicalCents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="mt-5">
        <h2 className={sectionTitle}>✍️ Added by hand</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          For bills the bank feed can&apos;t spot: school fees, the yearly car registration, anything paid by check. They count in Coming up
          and Safe to spend like the ones found from charges.
        </p>
        {manual.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {manual.map((b) => (
              <ManualBillCard key={b.id} jarId={jar.id} bill={b} next={nextDueOn(b, today, (d) => paid(ownKeys(b, found), d, b.amountCents, true))} today={today} choices={choices} />
            ))}
          </ul>
        )}
        <details className="mt-2">
          <summary className={`${btnPrimary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>+ Add a bill</summary>
          <ActionForm action={addManualBill.bind(null, jar.id)} className="mt-2 flex flex-col gap-3 rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20" resetOnSuccess>
            <BillFields today={today} choices={choices} />
            <Submit className={`${btnPrimary} self-start`}>Add the bill</Submit>
          </ActionForm>
        </details>
      </section>
      {section("Subscriptions", subs, "No subscriptions spotted yet. They show up after a couple of months of charges.")}
      {section("Other regular bills", others, "None spotted yet.")}

      {hidden.length > 0 && (
        <section className="mt-6">
          {showHidden ? (
            <>
              <h2 className={sectionTitle}>Hidden</h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {hidden.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words">{f.label}</span>
                    <form action={markRecurring.bind(null, jar.id, f.key, "CLEAR")}>
                      <SubmitButton className={btn}>
                        Show again
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Link href={`/finances/${jar.id}/bills?hidden=1`} className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline sm:min-h-9">
              Hidden ({hidden.length})
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

type Choice = readonly [key: string, label: string];
const cadenceWords = (c: ManualBillInput["cadence"]) => CADENCE_LABEL[c][0].toUpperCase() + CADENCE_LABEL[c].slice(1);

/** One bill added by hand: what it is, when it's next due, and its edit and remove forms. */
function ManualBillCard({
  jarId,
  bill,
  next,
  today,
  choices,
}: {
  jarId: string;
  bill: ManualBillInput & { createdBy: string | null };
  next: string | null;
  today: string;
  choices: Choice[];
}) {
  return (
    <li className="flex flex-col gap-1 rounded-2xl border-2 border-dashed border-ink/40 bg-card p-3 dark:border-white/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-extrabold break-words">✍️ {bill.name}</span>
        <span className="font-bold">{formatMoney(bill.amountCents)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {CADENCE_LABEL[bill.cadence]} · {next ? `${next < today ? "was due" : "next"} ${day(next)}` : `was due ${day(bill.nextDue)}, done`}
        {bill.createdBy && <> · added by {bill.createdBy}</>}
      </p>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-xl px-2 text-sm font-bold text-muted-foreground underline hover:bg-muted sm:min-h-9">
          Edit
        </summary>
        <ActionForm action={updateManualBill.bind(null, jarId, bill.id)} className="mt-2 flex flex-col gap-3">
          <BillFields today={today} choices={choices} bill={{ ...bill, nextDue: next ?? bill.nextDue }} />
          <Submit className={`${btn} self-start`}>Save</Submit>
        </ActionForm>
        <ActionForm action={removeManualBill.bind(null, jarId, bill.id)} className="mt-3 flex flex-col gap-2">
          <ConfirmSubmit question={`Remove ${bill.name}? It stops counting in Coming up and Safe to spend.`} yes="Yes, remove it">
            Remove
          </ConfirmSubmit>
        </ActionForm>
      </details>
    </li>
  );
}

/** The fields of "+ Add a bill" and Edit. */
function BillFields({ today, choices, bill }: { today: string; choices: Choice[]; bill?: ManualBillInput }) {
  const picked = bill && choices.some(([k]) => k === bill.matchKey) ? bill.matchKey : "";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Name</span>
        <input name="name" required maxLength={60} defaultValue={bill?.name} placeholder="School fees" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Amount ($)</span>
        <input name="amount" required inputMode="decimal" maxLength={20} defaultValue={centsToInput(bill?.amountCents)} placeholder="120.00" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>How often</span>
        <select name="cadence" defaultValue={bill?.cadence ?? "MONTHLY"} className={field}>
          {BILL_CADENCES.map((c) => (
            <option key={c} value={c}>
              {cadenceWords(c)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Next due</span>
        <input name="nextDue" type="date" required defaultValue={bill?.nextDue ?? today} className={field} />
      </label>
      {choices.length > 0 && (
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={fieldLabel}>Already found from charges?</span>
          <select name="matchKey" defaultValue={picked} className={field}>
            <option value="">No, it&apos;s a different bill</option>
            {choices.map(([key, label]) => (
              <option key={key} value={key}>
                Yes: {label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Pick it so the bill counts once, as the one you added.</span>
        </label>
      )}
    </div>
  );
}
