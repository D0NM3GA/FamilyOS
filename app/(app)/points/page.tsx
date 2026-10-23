import Link from "next/link";
import { getActiveProfile, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { formatRelative } from "@/lib/format";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { familySheetFill, moreNeeded, trackerLabel } from "@/lib/store/rules";
import { getFamilySheet, getMyOrders, getMyWallet, getOpenOrders, getStoreCatalog, getWallets } from "@/lib/store/queries";
import { StoreShelf } from "./store-shelf";
import { OrdersPanel } from "./orders-panel";
import { btn, btnPrimary, chip, chipRow } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";
import type { Metadata } from "next";
import { RewardWord } from "@/components/family-look";
import { getRewardWords } from "@/lib/household-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getRewardWords((await getActiveProfile())?.householdId)).store };
}

/**
 * Phase 20: the Sticker Store (route kept at /points). Everyone gets their wallet, saving
 * goal, the shelves and their own orders. Grown-ups also get "Orders to make happen", the
 * family sheet, everyone's wallets and the stocking page. Kids never see anyone else's
 * balance or orders — every kid-facing read here is keyed by the viewer's own id.
 */
export default async function StorePage({ searchParams }: { searchParams: Promise<{ bucket?: string }> }) {
  await requireAppOn("store");
  const profile = await requireActiveProfile();
  // "Earn more" points at Chores, so only while Chores is on.
  const choresOn = await appOn(profile.householdId, "chores");
  const adult = isAdult(profile);
  const { bucket } = await searchParams;
  const words = await getRewardWords(profile.householdId);

  const [catalog, wallet, myOrders, sheet, openOrders, wallets] = await Promise.all([
    getStoreCatalog(profile.householdId),
    getMyWallet(profile.id),
    getMyOrders(profile.id),
    getFamilySheet(profile.householdId),
    adult ? getOpenOrders(profile.householdId) : Promise.resolve([]),
    adult ? getWallets(profile.householdId) : Promise.resolve([]),
  ]);

  const shelf = bucket === "more" ? null : (catalog.buckets.find((b) => b.id === bucket) ?? null);
  const rewards = catalog.rewards.filter((r) =>
    bucket === "more" ? r.bucketId === null : shelf ? r.bucketId === shelf.id : true,
  );
  const hasUnshelved = catalog.buckets.length > 0 && catalog.rewards.some((r) => r.bucketId === null);
  const fill = familySheetFill(sheet.earned, sheet.goal);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">
            <RewardWord form="store" />
          </h1>
          <BunsonMoment kind="chatty" text={MOMENT_LINES.storeHello} className="mt-2" />
        </div>
        {adult && (
          <div className="flex flex-wrap gap-2">
            <Link href="/data#points" className={btn}>
              Export
            </Link>
            <Link href="/points/manage" className={btnPrimary}>
              Stock the store
            </Link>
          </div>
        )}
      </div>

      {adult && (
        <section id="orders" className="scroll-mt-20 rounded-3xl border-2 border-ink bg-card p-4 dark:border-white/20">
          <h2 className="text-xl font-extrabold">
            🛍️ Orders to make happen {openOrders.length > 0 && <span className="ml-1 rounded-full bg-tomato px-2 text-base text-ink">{openOrders.length}</span>}
          </h2>
          <OrdersPanel
            orders={openOrders.map((o) => ({ id: o.id, title: o.title, emoji: o.emoji, cost: o.cost, status: o.status, createdAt: o.createdAt, who: o.who }))}
          />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border-2 border-ink bg-sun p-5 text-ink shadow-[4px_4px_0_var(--color-ink)]">
          <p className="text-sm font-extrabold uppercase tracking-wider">My wallet</p>
          <p className="font-heading text-5xl font-extrabold leading-none">
            <span aria-hidden>⭐ </span>
            {wallet.balance}
          </p>
          <p className="font-bold"><RewardWord /> {wallet.balance < 0 ? "owed — a few chores will fix it" : "to spend"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/points/history" className="inline-flex min-h-11 items-center rounded-full border-2 border-ink bg-white/70 px-3 text-sm font-bold hover:bg-white sm:min-h-9">
              📜 Where they came from
            </Link>
            {choresOn && (
              <Link href={`/chores?person=${profile.id}`} className="inline-flex min-h-11 items-center rounded-full border-2 border-ink bg-white/70 px-3 text-sm font-bold hover:bg-white sm:min-h-9">
                🧹 Earn more
              </Link>
            )}
          </div>
          {wallet.goal && (
            <div className="mt-4">
              <p className="text-sm font-bold">
                Saving up for {wallet.goal.emoji ?? "🎁"} {wallet.goal.title}
              </p>
              <div className="mt-1 h-4 overflow-hidden rounded-full border-2 border-ink bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={wallet.goal.cost} aria-valuenow={Math.max(0, Math.min(wallet.balance, wallet.goal.cost))} aria-label="Saving progress">
                <div className="h-full bg-lime" style={{ width: `${Math.max(0, Math.min(100, (wallet.balance / wallet.goal.cost) * 100))}%` }} />
              </div>
              <p className="mt-1 text-sm font-semibold">
                {moreNeeded(wallet.balance, wallet.goal.cost) === 0
                  ? "You can get it now!"
                  : `${wallet.balance} of ${wallet.goal.cost}. ${moreNeeded(wallet.balance, wallet.goal.cost)} more to go!`}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-card p-5 ring-1 ring-border">
          <p className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Family sheet</p>
          <p className="font-heading text-3xl font-extrabold">
            {sheet.earned}
            {sheet.goal ? ` of ${sheet.goal}` : ""} <span className="text-lg font-bold text-muted-foreground">this month</span>
          </p>
          {sheet.goalTitle && <p className="font-bold">→ {sheet.goalTitle}</p>}
          {fill !== null && (
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)} aria-label="Family sheet progress">
              <div className="h-full bg-sky" style={{ width: `${fill * 100}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Every <RewardWord form="one" /> anyone earns lands here too. Spending never takes them back off.</p>
          {adult && wallets.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-bold text-muted-foreground">Wallets (only grown-ups see these)</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {wallets.map((w) => (
                  <li key={w.id} className="rounded-full bg-muted px-3 py-1 text-sm font-bold">
                    {w.firstName} ⭐ {w.points}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section>
        <nav aria-label="Store shelves" className={chipRow}>
          <ShelfTab href="/points" active={!bucket} label="All" />
          {catalog.buckets.map((b) => (
            <ShelfTab key={b.id} href={`/points?bucket=${b.id}`} active={bucket === b.id} label={`${b.emoji ?? ""} ${b.name}`.trim()} />
          ))}
          {hasUnshelved && <ShelfTab href="/points?bucket=more" active={bucket === "more"} label="More" />}
        </nav>
        <StoreShelf
          rewards={rewards}
          balance={wallet.balance}
          viewerId={profile.id}
          goalId={wallet.goal?.id ?? null}
          members={adult ? wallets : undefined}
        />
        {catalog.rewards.length === 0 && adult && (
          <p className="mt-2 text-sm text-muted-foreground">
            The store is empty. <Link href="/points/manage" className="font-bold text-brand-text hover:underline">Stock it</Link> with a few rewards.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-extrabold">My orders</h2>
        {myOrders.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nothing yet. Pick something from the shelves!</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {myOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
                <span className="text-2xl" aria-hidden>
                  {o.emoji ?? "🎁"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold break-words">{o.title}</p>
                  <p className="text-xs text-muted-foreground">
                    ⭐ {o.cost} · bought {formatRelative(o.createdAt).toLowerCase()}
                    {o.note && ` · “${o.note}”`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-extrabold ${
                    o.status === "DELIVERED"
                      ? "bg-lime text-ink"
                      : o.status === "TO_DO"
                        ? "bg-sky text-ink"
                        : o.status === "WAITING_OK"
                          ? "bg-sun text-ink"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {trackerLabel(o.status, words)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShelfTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={chip}>
      {label}
    </Link>
  );
}
