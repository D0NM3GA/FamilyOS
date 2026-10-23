import { prisma } from "@/lib/prisma";
import { moneyViewer } from "./access";
import { todayCivil } from "./budget";
import { visibleToWhere } from "./gifts";

export type TripCharge = { jarId: string; jarName: string; jarEmoji: string | null; month: string };

/**
 * The one money read Groceries may make (eslint.config.mjs lets this file, and only this one,
 * out of the finance boundary): which of these grocery trips a charge in the viewer's own jars
 * paid for, for Past trips' "💳 on Family". The money gate is the jar page's own: a grown-up
 * using the app as themselves (moneyViewer), only jars they're in, and never a charge that's
 * a surprise hidden from them. No amounts: just which jar, and the month to open it on.
 */
export async function tripCharges(purchaseIds: string[]): Promise<Map<string, TripCharge>> {
  const viewer = await moneyViewer();
  if (!viewer || purchaseIds.length === 0) return new Map();
  const rows = await prisma.finTransaction.findMany({
    where: {
      purchaseId: { in: purchaseIds.slice(0, 200) },
      state: "ACTIVE",
      jar: { householdId: viewer.householdId, members: { some: { personId: viewer.id } } },
      ...visibleToWhere(viewer.id, todayCivil()),
    },
    select: { purchaseId: true, postedOn: true, jar: { select: { id: true, name: true, emoji: true } } },
    orderBy: { postedOn: "asc" },
  });
  const out = new Map<string, TripCharge>();
  for (const r of rows) {
    if (!r.purchaseId || out.has(r.purchaseId)) continue;
    out.set(r.purchaseId, { jarId: r.jar.id, jarName: r.jar.name, jarEmoji: r.jar.emoji, month: r.postedOn.toISOString().slice(0, 7) });
  }
  return out;
}
