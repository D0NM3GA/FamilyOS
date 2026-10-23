import Link from "next/link";
import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { getOrCreateActiveList } from "@/lib/shopping-list";
import { getListItems, NO_STORE } from "@/lib/groceries/queries";
import { amountLabel, describeSize } from "@/lib/groceries/size";
import type { ShopRow } from "@/lib/groceries/shop";
import { ShopView } from "./shop-view";
import { SavedNote } from "./saved-note";
import { OfflineWorker } from "../offline-worker";
import { backLink } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Shopping" };

/**
 * Phase 23: the in-store view. Anyone in the family can shop (and finish the trip, as on
 * /groceries). Check-offs work without signal. No "heading to the store" alert, by the owner's
 * call. Phase 44.2: the page opens without signal too, from the copy the app's service worker
 * saves on the device (public/sw.js).
 */
export default async function ShopPage() {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const list = await getOrCreateActiveList(profile.householdId);
  const items = await getListItems(list.id);

  const rows: ShopRow[] = items.map((i) => ({
    id: i.id,
    name: i.product.name,
    size: describeSize(i.product),
    amount: amountLabel(i.quantity, i.product.container),
    emoji: i.product.group?.emoji ?? "🛒",
    storeName: i.product.defaultStore?.name ?? NO_STORE,
    sectionOrder: i.product.group?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    forName: i.requestedBy?.firstName ?? null,
    done: i.done,
  }));
  const stores = [...new Set(rows.map((r) => r.storeName))].sort((a, b) =>
    a === NO_STORE ? 1 : b === NO_STORE ? -1 : a.localeCompare(b),
  );

  return (
    // data-shop-saveable (SAVEABLE_MARK in public/sw.js): only a page that got this far, with the
    // list rendered, is saved for offline use. An error screen or a redirect streamed in its place
    // still arrives as a 200, but never carries it.
    <div data-shop-saveable className="mx-auto max-w-2xl p-4 pb-28 sm:p-6">
      <Link href="/groceries" className={backLink}>
        ← Back to the list
      </Link>
      <OfflineWorker saveShop />
      <div className="mt-2 flex flex-col gap-3">
        {/* eslint-disable-next-line react-hooks/purity -- the page is rendered per request; the time is what it shows */}
        <SavedNote renderedAt={Date.now()} />
        <ShopView householdId={profile.householdId} rows={rows} stores={stores} />
      </div>
    </div>
  );
}
