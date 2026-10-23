import { prisma } from "@/lib/prisma";
import { amountLabel } from "./size";

/**
 * Past trips: every finished trip, newest first, a page at a time. A trip's receipt prices
 * aren't linked to it by id (ItemPrice has no purchase column); saveReceiptPrices stamps
 * them with the trip's own purchasedAt instead, so that exact instant is the link.
 */

export const TRIPS_PER_PAGE = 20;

export type TripItem = { id: string; name: string; amount: string; emoji: string; forName: string | null };

export type Trip = {
  id: string;
  purchasedAt: Date;
  shopperName: string | null;
  items: TripItem[];
  /** How many receipt prices were saved for it; null when not asked for (kids). */
  pricesSaved: number | null;
};

/**
 * One page of trips. `before` is the last trip id of the previous page; an id that isn't
 * this family's trip just starts from the newest. `withPrices` is for grown-ups only.
 */
export async function getTrips(
  householdId: string,
  opts: { before?: string | null; withPrices: boolean; limit?: number },
): Promise<{ trips: Trip[]; olderCursor: string | null }> {
  const limit = opts.limit ?? TRIPS_PER_PAGE;
  const cursor = opts.before
    ? await prisma.purchase.findFirst({ where: { id: opts.before, householdId }, select: { id: true, purchasedAt: true } })
    : null;

  const rows = await prisma.purchase.findMany({
    where: {
      householdId,
      ...(cursor
        ? { OR: [{ purchasedAt: { lt: cursor.purchasedAt } }, { purchasedAt: cursor.purchasedAt, id: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      purchasedAt: true,
      purchasedBy: { select: { firstName: true } },
      items: {
        orderBy: { description: "asc" },
        select: {
          id: true,
          description: true,
          quantity: true,
          requestedBy: { select: { firstName: true } },
          product: { select: { container: true, group: { select: { emoji: true } } } },
        },
      },
    },
  });
  const page = rows.slice(0, limit);

  const priceCounts = new Map<number, number>();
  if (opts.withPrices && page.length > 0) {
    const counts = await prisma.itemPrice.groupBy({
      by: ["observedAt"],
      where: { householdId, observedAt: { in: page.map((p) => p.purchasedAt) } },
      _count: { _all: true },
    });
    for (const c of counts) priceCounts.set(c.observedAt.getTime(), c._count._all);
  }

  return {
    trips: page.map((p) => ({
      id: p.id,
      purchasedAt: p.purchasedAt,
      shopperName: p.purchasedBy?.firstName ?? null,
      items: p.items.map((i) => ({
        id: i.id,
        name: i.description,
        amount: amountLabel(i.quantity, i.product?.container ?? null),
        emoji: i.product?.group?.emoji ?? "🛒",
        forName: i.requestedBy?.firstName ?? null,
      })),
      pricesSaved: opts.withPrices ? (priceCounts.get(p.purchasedAt.getTime()) ?? 0) : null,
    })),
    olderCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today" / "Yesterday" / "Sat, Oct 4" (with the year once it isn't this one), and "5:12 PM". Server-local, like the trip's day everywhere else. */
export function describeTripWhen(at: Date, now: Date = new Date()): { day: string; time: string } {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const day = sameDay(at, now)
    ? "Today"
    : sameDay(at, yesterday)
      ? "Yesterday"
      : at.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
        });
  return { day, time: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) };
}
