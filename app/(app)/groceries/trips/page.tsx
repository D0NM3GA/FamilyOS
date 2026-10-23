import Link from "next/link";
import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { describeTripWhen, getTrips, type Trip } from "@/lib/groceries/trips";
import { backLink, btn, btnPrimary, card, pageTitle } from "@/components/styles";
import { tripCharges, type TripCharge } from "@/lib/finance/trip-links";
import { requireAppOn } from "@/lib/app-guard";
import { appOn } from "@/lib/app-switches";

export const metadata: Metadata = { title: "Past trips" };

function TripCard({ trip, adult, now, charge }: { trip: Trip; adult: boolean; now: Date; charge?: TripCharge }) {
  const when = describeTripWhen(trip.purchasedAt, now);
  const count = trip.items.length;
  const things = `${count} ${count === 1 ? "thing" : "things"}`;

  return (
    <li className={`${card} shadow-[3px_3px_0_rgb(31_41_51/0.15)]`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold leading-tight">{when.day}</h2>
          <p className="text-sm text-muted-foreground">
            {[when.time, trip.shopperName ? `${trip.shopperName} shopped` : null, things].filter(Boolean).join(" · ")}
          </p>
        </div>
        {/* Receipts are a grown-up job (prices are money), so kids see neither. */}
        {adult &&
          (trip.pricesSaved ? (
            <span className="inline-block -rotate-1 rounded-md bg-lime px-2 py-0.5 text-sm font-bold text-ink">
              🧾 {trip.pricesSaved} {trip.pricesSaved === 1 ? "price" : "prices"} saved
            </span>
          ) : (
            <Link href={`/groceries/receipts/new?purchase=${trip.id}`} className={btnPrimary}>
              📸 Snap the receipt
            </Link>
          ))}
      </div>

      {/* Only from the viewer's own jars, never a surprise hidden from them (lib/finance/trip-links.ts). */}
      {charge && (
        <Link
          href={`/finances/${charge.jarId}?month=${charge.month}`}
          className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-ink/20 px-3 text-sm font-bold hover:bg-muted sm:min-h-9 dark:border-white/20"
        >
          💳 Paid from {charge.jarEmoji ?? "💰"} {charge.jarName}
        </Link>
      )}

      {count > 0 && (
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-bold text-brand-text hover:underline sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition group-open:rotate-90" aria-hidden>
              ▸
            </span>
            <span className="group-open:hidden">See the {things}</span>
            <span className="hidden group-open:inline">Hide them</span>
          </summary>
          <ul className="mt-1 divide-y-2 divide-dashed divide-ink/10 dark:divide-white/10">
            {trip.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
                  {item.emoji}
                </span>
                <span className="min-w-0 flex-1 break-words font-bold leading-tight">
                  {item.name}
                  {item.forName && <span className="font-normal text-muted-foreground"> · for {item.forName}</span>}
                </span>
                <span className="shrink-0 rounded-lg border-2 border-ink/15 px-2 text-sm font-bold dark:border-white/15">{item.amount}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * Every finished trip, newest first, a page at a time, so a missed "Snap the receipt" note
 * isn't the only way to a trip's receipt. Anyone in the family can look back at what was
 * bought; receipts and prices stay with the grown-ups.
 */
export default async function TripsPage({ searchParams }: { searchParams: Promise<{ before?: string | string[] }> }) {
  await requireAppOn("groceries");
  const profile = await requireActiveProfile();
  const { before } = await searchParams;
  const adult = isAdult(profile);
  const cursor = typeof before === "string" && /^[\w-]{1,64}$/.test(before) ? before : null;

  const { trips, olderCursor } = await getTrips(profile.householdId, { before: cursor, withPrices: adult });
  // Empty for anyone Money doesn't open for (kids, a switched profile), and while the family
  // has Money turned off (Settings → Apps).
  const charges =
    adult && (await appOn(profile.householdId, "money")) ? await tripCharges(trips.map((t) => t.id)) : new Map<string, TripCharge>();
  const now = new Date();

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28 sm:p-6">
      <Link href="/groceries" className={backLink}>
        ← Back to the list
      </Link>
      <h1 className={`mt-1 ${pageTitle}`}>Past trips</h1>
      <p className="text-muted-foreground">
        {adult ? "What came home, trip by trip. Missed a receipt? Snap it here." : "What came home, trip by trip."}
      </p>

      {trips.length === 0 ? (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-ink/20 p-6 text-center font-bold text-muted-foreground dark:border-white/20">
          {cursor ? "No older trips." : "No trips yet. Check things off in 🛒 Shop and tap Finish trip."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} adult={adult} now={now} charge={charges.get(trip.id)} />
          ))}
        </ul>
      )}

      {(cursor || olderCursor) && (
        <nav aria-label="More trips" className="mt-4 flex flex-wrap justify-between gap-2">
          {cursor ? (
            <Link href="/groceries/trips" className={btn}>
              ← Newest trips
            </Link>
          ) : (
            <span />
          )}
          {olderCursor && (
            <Link href={`/groceries/trips?before=${olderCursor}`} className={btn}>
              Older trips →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
