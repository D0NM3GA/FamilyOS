import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireJar } from "@/lib/finance/access";
import { scheduleJarSync } from "@/lib/finance/schedule";
import { ensureCategories, organizeJar } from "@/lib/finance/organize";
import { formatMoney } from "@/lib/money";
import { todayCivil } from "@/lib/finance/budget";
import { findCategoryByKey } from "@/lib/finance/categories";
import { leftOutAccountIds } from "@/lib/finance/left-out";
import { ACTIVITY_MONTH_LIMIT, activityFilters, activityHref, activityWhere, monthSteps } from "@/lib/finance/activity";
import { isUnrevealed, MAX_REVEAL_DAYS, visibleIssueWhere } from "@/lib/finance/gifts";
import { orderItems, ordersOnCharges, RETAILER_NAME, unmatchedOrders, type OrderView } from "@/lib/finance/order-mail/orders";
import { scheduleOrderScan } from "@/lib/finance/order-mail/scan";
import { jarHistory, merchantLabel } from "@/lib/finance/history";
import { btn, chip, chipRow, field, sectionTitle } from "@/components/styles";
import { linkOrder, linkTrip, markGift, markOrderGift, revealGift, revealOrderGift, unlinkOrder, unlinkTrip } from "../actions";
import { ActionForm, Submit } from "../forms";
import { JarHeader } from "./jar-header";
import { CategoryPicker } from "./category-picker";
import { TxnSheet } from "./txn-sheet";
import { HistoryList } from "./history";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Money" };

const utcDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const DAY = 86_400_000;
const monthName = (m: string, month: "short" | "long" = "long") =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month, year: "numeric", timeZone: "UTC" });
const monthStep = `${btn} shrink-0`;
/** A checkbox and its words: the whole row is the thumb target. */
const checkRow = "flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9";

/**
 * Phase 25/26: one jar: accounts, what needs a look, and its transactions, a month at a time
 * (lib/finance/activity.ts), filtered by account and category. Each row is one tap target
 * that opens everything you can do to that charge (category, surprise, grocery trip, order)
 * in a sheet. Members only. Phase 27: surprises hidden from the viewer aren't listed (or
 * counted) here, or in the spreadsheet.
 */
export default async function JarPage({
  params,
  searchParams,
}: {
  params: Promise<{ jarId: string }>;
  searchParams: Promise<{ account?: string | string[]; category?: string | string[]; month?: string | string[] }>;
}) {
  await requireAppOn("money");
  const { jarId } = await params;
  const { jar, viewer } = await requireJar(jarId);
  const today = todayCivil();
  const asked = activityFilters(await searchParams, today);

  await Promise.all([
    // Keeps the bank feed fresh without blocking the page (6-hour rule, after the response).
    scheduleJarSync(jar.id, { force: false }),
    // Phase 29: this person's own order emails, if they read them into this jar.
    scheduleOrderScan(viewer.id, jar.id, { force: false }),
    ensureCategories(prisma, jar.id),
  ]);
  // Rows from before categories existed get tidied once (later rows are tidied on arrival).
  if (await prisma.finTransaction.count({ where: { jarId: jar.id, merchantKey: "" } })) await organizeJar(jar.id);

  const [accounts, issues, connections, categories, members, leftOut] = await Promise.all([
    prisma.finAccount.findMany({ where: { jarId: jar.id }, orderBy: [{ source: "asc" }, { name: "asc" }] }),
    prisma.reconcileIssue.count({ where: { jarId: jar.id, resolvedAt: null, ...visibleIssueWhere(viewer.id, today) } }),
    prisma.jarConnection.findMany({ where: { jarId: jar.id }, select: { lastError: true } }),
    prisma.finCategory.findMany({ where: { jarId: jar.id }, orderBy: { sortOrder: "asc" }, select: { id: true, key: true, absorbedKeys: true, name: true, emoji: true } }),
    prisma.moneyJarMember.findMany({ where: { jarId: jar.id }, select: { personId: true, person: { select: { firstName: true } } } }),
    leftOutAccountIds(jar.id),
  ]);
  const shownAccount = accounts.find((a) => a.id === asked.account) ?? null;
  const shownCategory = asked.category === "none" ? "none" : (categories.find((c) => c.id === asked.category) ?? null);
  const filters = {
    month: asked.month,
    account: shownAccount?.id ?? null,
    category: shownCategory === "none" ? "none" : (shownCategory?.id ?? null),
  };
  const steps = monthSteps(filters.month, today);

  const [found, counts] = await Promise.all([
    prisma.finTransaction.findMany({
      where: activityWhere(jar.id, viewer.id, today, { ...filters, leftOut: true }),
      orderBy: [{ postedOn: "desc" }, { createdAt: "desc" }],
      take: ACTIVITY_MONTH_LIMIT + 1,
      select: {
        id: true,
        postedOn: true,
        amountCents: true,
        description: true,
        payee: true,
        merchantName: true,
        merchantKey: true,
        memo: true,
        privacyCardMemo: true,
        pending: true,
        state: true,
        categoryId: true,
        categorySource: true,
        purchaseId: true,
        giftById: true,
        giftHiddenFrom: true,
        giftRevealOn: true,
        account: { select: { name: true, currency: true } },
        purchase: { select: { purchasedAt: true, _count: { select: { items: true } }, items: { select: { description: true }, take: 40 } } },
      },
    }),
    // How many rows each category has this month (under the account filter), for the chips.
    prisma.finTransaction.groupBy({
      by: ["categoryId"],
      where: activityWhere(jar.id, viewer.id, today, { month: filters.month, account: filters.account, leftOut: true }),
      _count: { _all: true },
    }),
  ]);
  const more = found.length > ACTIVITY_MONTH_LIMIT;
  const txns = found.slice(0, ACTIVITY_MONTH_LIMIT);
  const countOf = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const monthTotal = counts.reduce((n, c) => n + c._count._all, 0);
  const uncategorized = countOf.get(null) ?? 0;

  // Trips a member of this jar saved, for the "which trip?" picker on unlinked grocery rows
  // (Groceries, or the category it was removed into).
  const groceries = findCategoryByKey(categories, "groceries");
  const needsTrip = txns.filter((t) => groceries && t.categoryId === groceries.id && !t.purchaseId && t.amountCents < 0);
  const trips = needsTrip.length
    ? await prisma.purchase.findMany({
        where: {
          householdId: viewer.householdId,
          purchasedById: { in: members.map((m) => m.personId) },
          // Not a trip another charge in this jar already has.
          finTransactions: { none: { jarId: jar.id, state: { in: ["ACTIVE", "IGNORED"] } } },
          purchasedAt: {
            gte: new Date(Math.min(...needsTrip.map((t) => t.postedOn.getTime())) - 7 * DAY),
            lte: new Date(Math.max(...needsTrip.map((t) => t.postedOn.getTime())) + 7 * DAY),
          },
        },
        select: { id: true, purchasedAt: true, purchasedBy: { select: { firstName: true } }, _count: { select: { items: true } } },
        orderBy: { purchasedAt: "desc" },
      })
    : [];
  const pickable = categories.map(({ id, name, emoji }) => ({ id, name, emoji }));
  const catById = new Map(pickable.map((c) => [c.id, c]));
  const nameOf = new Map(members.map((m) => [m.personId, m.person.firstName]));
  const [orders, unmatched, recent] = await Promise.all([
    ordersOnCharges(jar.id, txns.map((t) => t.id), viewer.id, today),
    unmatchedOrders(jar.id, viewer.id, today),
    jarHistory(jar.id, viewer.id, today, 8),
  ]);
  const orderOn = new Map(orders.map((o) => [o.matchedTxnId!, o]));
  const outRows = txns.filter((t) => t.amountCents < 0);
  const others = members.filter((m) => m.personId !== viewer.id);
  const dayAfter = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const href = (f: Partial<typeof filters>) => activityHref(jar.id, { ...filters, ...f });
  const filterWords = [shownAccount?.name, shownCategory === "none" ? "uncategorized" : shownCategory?.name].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6">
      <JarHeader jar={jar} active="activity" />

      {connections.some((c) => c.lastError) && (
        <p role="alert" className="mt-3 rounded-xl bg-tomato/15 px-3 py-2 text-sm font-semibold">
          {connections.find((c) => c.lastError)?.lastError}
        </p>
      )}
      {issues > 0 && (
        <Link href={`/finances/${jar.id}/review`} className="mt-3 flex min-h-11 items-center rounded-xl bg-sun/40 px-3 py-2 text-sm font-bold">
          🔎 {issues} thing{issues === 1 ? "" : "s"} need{issues === 1 ? "s" : ""} a look →
        </Link>
      )}

      {accounts.length === 0 ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink/25 p-6 text-center dark:border-white/20">
          <p className="font-bold">No accounts yet.</p>
          <p className="text-sm text-muted-foreground">
            Connect a bank feed (SimpleFIN) or import a statement file in{" "}
            <Link href={`/finances/${jar.id}/settings`} className="underline">
              Settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link
                href={href({ account: shownAccount?.id === a.id ? null : a.id })}
                aria-current={shownAccount?.id === a.id ? "true" : undefined}
                className="flex flex-col rounded-2xl border-2 border-ink bg-card p-3 aria-[current=true]:bg-sun/20 dark:border-white/20"
              >
                <span className="text-sm text-muted-foreground">
                  {a.org ? `${a.org} · ` : ""}
                  {a.source === "MANUAL" ? "from statements" : "bank feed"}
                </span>
                <span className="font-extrabold break-words">{a.name}</span>
                {leftOut.has(a.id) && <span className="text-xs font-bold text-muted-foreground">Left out of the totals</span>}
                <span className="text-2xl font-extrabold">{a.balanceCents != null ? formatMoney(a.balanceCents, a.currency) : "—"}</span>
                {a.balanceAt && <span className="text-xs text-muted-foreground">as of {a.balanceAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {accounts.length > 0 && (
        <>
          <nav aria-label="Months" className="mt-5 flex items-center justify-between gap-2">
            {steps.older ? (
              <Link href={href({ month: steps.older })} className={monthStep} aria-label={`Older: ${monthName(steps.older)}`}>
                ← Older
              </Link>
            ) : (
              <span />
            )}
            <h2 className="min-w-0 text-center text-lg font-extrabold sm:text-xl">{monthName(filters.month)}</h2>
            {steps.newer ? (
              <Link href={href({ month: steps.newer })} className={monthStep} aria-label={`Newer: ${monthName(steps.newer)}`}>
                Newer →
              </Link>
            ) : (
              <span />
            )}
          </nav>

          <nav aria-label="Filter by category" className={`mt-3 ${chipRow}`}>
            <Link href={href({ category: null })} aria-current={!shownCategory ? "page" : undefined} className={chip}>
              All {monthTotal > 0 && <span className="font-normal">{monthTotal}</span>}
            </Link>
            {(uncategorized > 0 || shownCategory === "none") && (
              <Link href={href({ category: "none" })} aria-current={shownCategory === "none" ? "page" : undefined} className={chip}>
                Uncategorized <span className="font-normal">{uncategorized}</span>
              </Link>
            )}
            {categories.map((c) => {
              const n = countOf.get(c.id) ?? 0;
              return (
                <Link key={c.id} href={href({ category: c.id })} aria-current={filters.category === c.id ? "page" : undefined} className={chip}>
                  {c.emoji} {c.name} {n > 0 && <span className="font-normal">{n}</span>}
                </Link>
              );
            })}
          </nav>
        </>
      )}

      {accounts.length > 0 && txns.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          Nothing in {monthName(filters.month)}
          {filterWords ? ` for ${filterWords}` : ""}.
        </p>
      )}
      {more && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the latest {ACTIVITY_MONTH_LIMIT} this month. Pick an account or a category to see the rest.
        </p>
      )}
      {txns.length > 0 && (
        <ul className="mt-3 divide-y-2 divide-dashed divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-card dark:divide-white/10 dark:border-white/20">
          {txns.map((t) => {
            const name = t.merchantName ?? t.payee ?? t.description;
            const cat = t.categoryId ? (catById.get(t.categoryId) ?? null) : null;
            const merchant = t.merchantKey === "-" ? "" : t.merchantKey;
            const amount = formatMoney(t.amountCents, t.account.currency);
            const order = orderOn.get(t.id);
            const surprise = isUnrevealed(t, today);
            const tripChoices =
              groceries && t.categoryId === groceries.id && !t.purchaseId && t.amountCents < 0
                ? trips.filter((p) => Math.abs(p.purchasedAt.getTime() - t.postedOn.getTime()) <= 7 * DAY)
                : [];
            const meta = [t.state === "IGNORED" ? "left out" : null, t.pending ? "pending" : null, shownAccount ? null : t.account.name].filter(Boolean).join(" · ");
            return (
              <li key={t.id}>
                <TxnSheet
                  label={`${utcDay(t.postedOn)}, ${name}, ${amount}, ${cat ? cat.name : "no category"}${t.pending ? ", pending" : ""}${t.state === "IGNORED" ? ", left out" : ""}${surprise ? ", a surprise" : ""}`}
                  title={name}
                  summary={
                    <>
                      <span className="w-12 shrink-0 text-sm font-bold text-muted-foreground">{utcDay(t.postedOn)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">
                          {t.privacyCardMemo && "🔒 "}
                          {name}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 font-bold ring-1 ${cat ? "text-foreground ring-input" : "bg-sun/40 text-ink ring-sun"}`}
                          >
                            {cat ? `${cat.emoji ?? ""} ${cat.name}`.trim() : "+ category"}
                          </span>
                          {(surprise || t.purchase || order) && (
                            <span aria-hidden className="shrink-0">
                              {surprise && "🎁"}
                              {t.purchase && "🛒"}
                              {order && "📦"}
                            </span>
                          )}
                          {meta && <span className="truncate">{meta}</span>}
                        </span>
                      </span>
                      <span className={`shrink-0 font-bold tabular-nums ${t.amountCents > 0 ? "text-brand-text" : ""}`}>{amount}</span>
                    </>
                  }
                >
                  <div className="flex flex-col gap-0.5 text-sm">
                    <p className={`text-2xl font-extrabold ${t.amountCents > 0 ? "text-brand-text" : ""}`}>{amount}</p>
                    <p className="text-muted-foreground">
                      {longDay(t.postedOn)} · {t.account.name}
                      {t.pending && " · pending"}
                    </p>
                    {t.state === "IGNORED" && <p className="text-xs text-muted-foreground">Its account is left out of this jar, so it isn&apos;t in any total.</p>}
                    {t.privacyCardMemo && <p className="break-words">🔒 Privacy.com card: {t.privacyCardMemo}</p>}
                    {t.description !== name && <p className="text-xs break-words text-muted-foreground">The bank says: {t.description}</p>}
                    {t.memo && <p className="text-xs break-words text-muted-foreground">Memo: {t.memo}</p>}
                  </div>

                  <section className="flex flex-col gap-2">
                    <h3 className={sectionTitle}>Category</h3>
                    <CategoryPicker
                      jarId={jar.id}
                      txnId={t.id}
                      current={cat}
                      merchant={merchant}
                      merchantLabel={merchantLabel(merchant)}
                      categories={pickable}
                      bySomeone={t.categorySource === "PERSON"}
                      byRule={t.categorySource === "RULE"}
                    />
                  </section>

                  {order && (
                    <section className="flex flex-col gap-2">
                      <h3 className={sectionTitle}>📦 Order</h3>
                      <OrderDetails jarId={jar.id} order={order} />
                    </section>
                  )}

                  {(t.purchase || tripChoices.length > 0) && (
                    <section className="flex flex-col gap-2">
                      <h3 className={sectionTitle}>🛒 Grocery trip</h3>
                      {t.purchase ? (
                        <>
                          <p className="font-bold">
                            Trip on {t.purchase.purchasedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {t.purchase._count.items} item
                            {t.purchase._count.items === 1 ? "" : "s"}
                          </p>
                          <p className="text-sm text-muted-foreground">{t.purchase.items.map((i) => i.description).join(", ")}</p>
                          <form action={unlinkTrip.bind(null, jar.id, t.id)}>
                            <Submit className={btn}>Not this trip</Submit>
                          </form>
                        </>
                      ) : (
                        <form action={linkTrip.bind(null, jar.id, t.id)} className="flex flex-wrap items-center gap-2">
                          <select name="purchaseId" aria-label="Which grocery trip?" className={`${field} min-w-0 flex-1`}>
                            {tripChoices.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.purchasedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {p._count.items} items
                                {p.purchasedBy ? ` · ${p.purchasedBy.firstName}` : ""}
                              </option>
                            ))}
                          </select>
                          <Submit className={btn}>Link trip</Submit>
                        </form>
                      )}
                    </section>
                  )}

                  {(surprise || others.length > 0) && (
                    <section className="flex flex-col gap-2">
                      <h3 className={sectionTitle}>🎁 Surprise</h3>
                      <Surprise
                        mark={t}
                        today={today}
                        viewerId={viewer.id}
                        nameOf={nameOf}
                        others={others}
                        markAction={markGift.bind(null, jar.id, t.id)}
                        revealAction={revealGift.bind(null, jar.id, t.id)}
                        days={[dayAfter(1), dayAfter(MAX_REVEAL_DAYS)]}
                      />
                    </section>
                  )}
                </TxnSheet>
              </li>
            );
          })}
        </ul>
      )}
      {accounts.length > 0 && steps.older && (
        <Link href={href({ month: steps.older })} className={`${btn} mt-3`}>
          ← {monthName(steps.older)}
        </Link>
      )}

      {unmatched.length > 0 && (
        <section className="mt-6 rounded-2xl border-2 border-dashed border-ink/25 p-4 dark:border-white/20">
          <h2 className="font-extrabold">📦 From order emails, not matched to a charge yet</h2>
          <p className="text-sm text-muted-foreground">
            They match by themselves when the charge arrives. Amazon charges each shipment separately, so split orders need a hand. Buying a
            gift? Mark the order 🎁 here and its charge stays a surprise when it arrives.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {unmatched.map((o) => {
              const near = outRows.filter((t) => Math.abs(t.postedOn.getTime() - o.orderedOn.getTime()) <= 30 * DAY);
              return (
                <li key={o.id} className="flex flex-col gap-1 rounded-xl bg-muted/50 p-2 text-sm">
                  <OrderLine order={o} />
                  <Surprise
                    fold
                    mark={o}
                    today={today}
                    viewerId={viewer.id}
                    nameOf={nameOf}
                    others={others}
                    markAction={markOrderGift.bind(null, jar.id, o.id)}
                    revealAction={revealOrderGift.bind(null, jar.id, o.id)}
                    days={[dayAfter(1), dayAfter(MAX_REVEAL_DAYS)]}
                  />
                  {near.length > 0 && (
                    <form action={linkOrder.bind(null, jar.id, o.id)} className="flex flex-wrap items-center gap-2">
                      <select name="txnId" aria-label="Which charge?" className={`${field} max-w-full min-w-0 flex-1`}>
                        {near.map((t) => (
                          <option key={t.id} value={t.id}>
                            {utcDay(t.postedOn)} · {formatMoney(t.amountCents, t.account.currency)} · {(t.merchantName ?? t.payee ?? t.description).slice(0, 40)}
                          </option>
                        ))}
                      </select>
                      <Submit className={btn}>This charge</Submit>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {accounts.length > 0 && (
        <section className="mt-6 rounded-2xl border-2 border-ink/15 p-4 dark:border-white/15">
          <h2 className="font-extrabold">📄 Spreadsheet</h2>
          <p className="text-sm text-muted-foreground">
            The jar&apos;s activity as a CSV file for Excel or Google Sheets: every account and category. Surprises meant for you stay out. The
            jar&apos;s history notes that you made one.
          </p>
          {/* A POST, not a link: nothing prefetches or re-fetches a download, and each one is noted. */}
          <form method="post" action={`/finances/${jar.id}/export`} className="mt-2 flex flex-wrap gap-2">
            <button type="submit" name="month" value={filters.month} className={btn}>
              ⬇️ {monthName(filters.month)}
            </button>
            <button type="submit" name="month" value="all" className={btn}>
              ⬇️ Everything
            </button>
          </form>
        </section>
      )}

      {recent.length > 0 && (
        <details className="mt-6 rounded-2xl border-2 border-ink/15 p-4 dark:border-white/15">
          <summary className="cursor-pointer py-2 font-extrabold sm:py-0">🕘 Recently</summary>
          <div className="mt-2">
            <HistoryList lines={recent} />
          </div>
          <Link href={`/finances/${jar.id}/history`} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline sm:min-h-9">
            See all
          </Link>
        </details>
      )}
    </div>
  );
}

type GiftMark = { giftById: string | null; giftHiddenFrom: string[]; giftRevealOn: Date | null };

/**
 * 🎁 on a charge or an order email: who it's a surprise for and when it shows (the marker can
 * show it now), or the form that makes it one. Never rendered for the people it's hidden
 * from: their queries don't return the row at all. `fold` tucks the form behind "🎁 Surprise?"
 * (the order list); in a charge's sheet it's shown as is.
 */
function Surprise({
  mark,
  today,
  viewerId,
  nameOf,
  others,
  markAction,
  revealAction,
  days,
  fold = false,
}: {
  mark: GiftMark;
  today: string;
  viewerId: string;
  nameOf: Map<string, string>;
  others: { personId: string; person: { firstName: string } }[];
  markAction: (prev: { ok?: string; error?: string }, formData: FormData) => Promise<{ ok?: string; error?: string }>;
  revealAction: () => Promise<void>;
  days: [string, string];
  fold?: boolean;
}) {
  if (isUnrevealed(mark, today)) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span>
          🎁 Surprise for {mark.giftHiddenFrom.map((id) => nameOf.get(id) ?? "someone").join(", ")} · shows {utcDay(mark.giftRevealOn!)}
        </span>
        {mark.giftById === viewerId && (
          <form action={revealAction}>
            <Submit className={btn}>Show it now</Submit>
          </form>
        )}
      </div>
    );
  }
  if (others.length === 0) return null;
  const form = (
    <ActionForm action={markAction} className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">Hide it from them until the day you pick. Totals still add up.</span>
      {others.map((o) => (
        <label key={o.personId} className={checkRow}>
          <input type="checkbox" name="hiddenFrom" value={o.personId} defaultChecked className="size-5 shrink-0" />
          {o.person.firstName}
        </label>
      ))}
      <label className="flex flex-wrap items-center gap-2 text-sm">
        until
        <input type="date" name="revealOn" required min={days[0]} max={days[1]} className={field} />
      </label>
      <Submit className={`${btn} mt-1 self-start`}>🤫 Keep it secret</Submit>
    </ActionForm>
  );
  if (!fold) return form;
  return (
    <details className="text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center text-muted-foreground sm:min-h-9">🎁 Surprise?</summary>
      <div className="mt-1">{form}</div>
    </details>
  );
}

/** One order's headline: who, what, when, how much, and whose email it came from. */
function OrderLine({ order }: { order: OrderView }) {
  return (
    <span className="font-bold">
      📦 {RETAILER_NAME[order.retailer]}
      {order.label ? ` · ${order.label}` : ""} · {utcDay(order.orderedOn)}
      {order.totalCents != null && <> · {formatMoney(order.totalCents)}</>}
      {order.person && <span className="font-normal text-muted-foreground"> · {order.person.firstName}&apos;s email</span>}
    </span>
  );
}

/** Phase 29: the order on a charge, for everyone in the jar. */
function OrderDetails({ jarId, order }: { jarId: string; order: OrderView }) {
  const items = orderItems(order);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <OrderLine order={order} />
      {items.length > 0 && (
        <ul className="text-muted-foreground">
          {items.map((i, n) => (
            <li key={n}>
              {i.qty > 1 ? `${i.qty} × ` : ""}
              {i.name}
              {i.priceCents != null ? ` · ${formatMoney(i.priceCents)}` : ""}
            </li>
          ))}
        </ul>
      )}
      <form action={unlinkOrder.bind(null, jarId, order.id)}>
        <Submit className={btn}>Not this charge</Submit>
      </form>
    </div>
  );
}
