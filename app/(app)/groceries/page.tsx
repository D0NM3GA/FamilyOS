import Link from "next/link";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getOrCreateActiveList } from "@/lib/shopping-list";
import {
  ensureStartingSections,
  getListItems,
  groupItemsByStore,
  getRecentlyBought,
  getPantrySuggestions,
  getKidTiles,
} from "@/lib/groceries/queries";
import { AddBox } from "./add-box";
import { ItemSheet } from "./item-sheet";
import { finishTrip, addItem } from "./actions";
import { ListRow } from "./list-row";
import { ListDock } from "./list-undo";
import { KidTiles } from "./kid-tiles";
import { QueueStatus } from "./shop-queue";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary, chipRow, sectionTitle } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";
import { OfflineWorker } from "./offline-worker";

// Not the shared chip: these carry their own border colors (sun for "need soon").
const chip =
  "inline-flex min-h-11 items-center rounded-full border-2 px-3 text-sm font-bold transition hover:-translate-y-0.5 sm:min-h-9";
const stickerBtn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-ink px-3 text-sm font-bold sm:min-h-9";

export default async function GroceriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    item?: string | string[];
    trip?: string | string[];
    purchase?: string | string[];
    prices?: string | string[];
  }>;
}) {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const { item: itemParam, trip, purchase, prices } = await searchParams;
  const sheetId = typeof itemParam === "string" ? itemParam : null;
  const adult = isAdult(profile);
  // Only shapes a link; the receipt page checks the trip is this family's.
  const savedTripId = typeof purchase === "string" && /^[\w-]{1,64}$/.test(purchase) ? purchase : null;

  const [, list] = await Promise.all([ensureStartingSections(profile.householdId), getOrCreateActiveList(profile.householdId)]);
  const items = await getListItems(list.id);
  const grouped = groupItemsByStore(items);

  // Both chip rows leave out anything already on the list, and "probably need soon" wins
  // over a duplicate "recently bought" chip, so tapping a chip makes it disappear rather
  // than hop from one row to the other. Keys: productId, else (old history) the description.
  const currentListKeys = new Set(items.map((i) => i.productId));
  const [pantrySuggestions, recentlyBoughtAll, kidTiles] = await Promise.all([
    getPantrySuggestions(profile.householdId, { excludeKeys: currentListKeys }),
    getRecentlyBought(profile.householdId),
    profile.role === "KID"
      ? getKidTiles(profile.householdId, profile.id, new Set(items.filter((i) => !i.done).map((i) => i.productId)))
      : [],
  ]);
  const pantryKeys = new Set(pantrySuggestions.map((s) => s.key));
  const recentlyBought = recentlyBoughtAll.filter((r) => {
    const key = r.productId ?? r.description.toLowerCase();
    return !pantryKeys.has(key) && !currentListKeys.has(key);
  });

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="p-4 pb-28 sm:p-6 sm:pb-28">
      <OfflineWorker />
      <PageHeader title="Groceries">
        <Link href="/groceries/shop" className={`${stickerBtn} bg-lime text-ink hover:brightness-95`}>
          🛒 Shop
        </Link>
        <Link href="/groceries/pantry" className={`${stickerBtn} hover:bg-muted dark:border-white/20`}>
          🥫 Pantry
        </Link>
        <Link href="/groceries/trips" className={`${stickerBtn} hover:bg-muted dark:border-white/20`}>
          🧾 Past trips
        </Link>
        <Link href="/print/groceries" className={btn}>
          Print
        </Link>
        {adult && (
          <Link href="/data#groceries" className={btn}>
            Export
          </Link>
        )}
      </PageHeader>

      {trip === "saved" && (
        <div role="status" className="mt-3 rounded-xl bg-lime/30 px-3 py-2 text-sm font-bold">
          <p>
            Trip saved! Anything you didn&apos;t get is still on the list.
            {adult && " Snap the receipt to keep the prices, now or later from Past trips."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {adult && (
              <Link href={savedTripId ? `/groceries/receipts/new?purchase=${savedTripId}` : "/groceries/receipts/new"} className={btnPrimary}>
                📸 Snap the receipt
              </Link>
            )}
            <Link href="/groceries/trips" className={`${btn} bg-card`}>
              🧾 Past trips
            </Link>
          </div>
        </div>
      )}
      {adult && typeof prices === "string" && /^\d+$/.test(prices) && (
        <p role="status" className="mt-3 rounded-xl bg-lime/30 px-3 py-2 text-sm font-bold">
          {prices === "0" ? "Nothing priced from that receipt." : `Saved ${prices} price${prices === "1" ? "" : "s"} from the receipt.`}
        </p>
      )}
      <QueueStatus householdId={profile.householdId} />

      {/* Keyed on the server's tile set, so tiles hidden on tap reset when it changes (a veto brings one back). */}
      <KidTiles key={kidTiles.map((t) => t.id).join(",")} tiles={kidTiles} />

      <div className="mt-4">
        <AddBox />
      </div>

      {pantrySuggestions.length > 0 && (
        <div className="mt-2">
          <h2 className={sectionTitle}>Probably need soon</h2>
          <div className={`mt-2 ${chipRow}`}>
            {pantrySuggestions.map((s) => (
              <form key={s.key} action={addItem.bind(null, s.productId ? { productId: s.productId } : { name: s.label })}>
                <SubmitButton
                  title={`Usually bought every ~${Math.round(s.medianIntervalDays)} days — last bought ${s.daysSinceLast} days ago`}
                  className={`${chip} border-sun bg-sun/20 text-foreground`}
                >
                  + {s.label}
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}

      {recentlyBought.length > 0 && (
        <div className={`mt-3 ${chipRow}`}>
          {recentlyBought.map((r) => (
            <form key={r.productId ?? r.description} action={addItem.bind(null, r.productId ? { productId: r.productId } : { name: r.description })}>
              <SubmitButton className={`${chip} border-ink/15 bg-card text-muted-foreground dark:border-white/15`}>
                + {r.description}
              </SubmitButton>
            </form>
          ))}
        </div>
      )}

      {/* The dock holds the − Undo bar and Finish trip (see list-undo.tsx for its pointer-events). */}
      <ListDock
        footer={
          doneCount > 0 ? (
            <form action={finishTrip}>
              <SubmitButton
                className="pointer-events-auto mx-auto block w-full max-w-lg rounded-2xl border-2 border-ink bg-lime py-3 font-extrabold text-ink shadow-[3px_3px_0_rgb(31_41_51/0.25)] hover:brightness-95"
              >
                Finish trip ({doneCount} {doneCount === 1 ? "item" : "items"} in the cart)
              </SubmitButton>
            </form>
          ) : null
        }
      >
        <div className="mt-6 space-y-6">
          {items.length === 0 ? (
            <BunsonMoment kind="cheer" text={`${MOMENT_LINES.groceriesEmpty} Add something above.`} />
          ) : (
            grouped.map((group) => (
              <section key={group.storeName}>
                <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
                  <span className="min-w-0 truncate">{group.storeName}</span>
                  <span className="rounded-full bg-muted px-2 text-xs">{group.items.filter((i) => !i.done).length}</span>
                </h2>
                <ul className="mt-2 divide-y-2 divide-dashed divide-ink/10 overflow-hidden rounded-2xl border-2 border-ink bg-card shadow-[3px_3px_0_rgb(31_41_51/0.15)] dark:border-white/20 dark:divide-white/10">
                  {group.items.map((item) => (
                    <ListRow
                      key={item.id}
                      item={item}
                      href={`/groceries?item=${item.productId}`}
                      vetoable={adult && item.kidPick && !item.done}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </ListDock>

      {sheetId && <ItemSheet productId={sheetId} profile={profile} returnTo="/groceries" />}
    </div>
  );
}
