import { prisma } from "@/lib/prisma";
import { RECURRING_WINDOW_DAYS } from "./recurring";
import { visibleToWhere } from "./gifts";
import { tidyMerchantName } from "./merchant-name";

/**
 * Phase 63b: a jar's charges the bill finder reads (the last RECURRING_WINDOW_DAYS, USD, money in
 * only on spending accounts, none hidden from this viewer as a surprise), shaped for findRecurring.
 * Shared by the Bills page and the calendar's bills (lib/finance/calendar-bills.ts), so both see
 * the same bills.
 */
export async function recurringRows(
  jarId: string,
  viewerId: string,
  today: string,
) {
  const since = new Date(
    Date.parse(`${today}T00:00:00Z`) - RECURRING_WINDOW_DAYS * 86_400_000,
  );
  const rows = await prisma.finTransaction.findMany({
    where: {
      jarId,
      state: "ACTIVE",
      postedOn: { gte: since },
      account: { currency: "USD" },
      AND: [
        // Money in only matters on spending accounts (paydays).
        {
          OR: [
            { amountCents: { lt: 0 } },
            { amountCents: { gt: 0 }, account: { spending: true } },
          ],
        },
        visibleToWhere(viewerId, today),
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
  });
  return rows.map((r) => ({
    key: r.merchantKey === "-" ? "" : r.merchantKey,
    label: r.merchantName ?? tidyMerchantName(r.payee ?? r.description),
    postedOn: r.postedOn.toISOString().slice(0, 10),
    amountCents: r.amountCents,
    privacyCardToken: r.privacyCharges[0]?.cardToken ?? null,
    privacyCardMemo: r.privacyCardMemo,
    category: r.category,
    pending: r.pending,
    accountId: r.accountId,
  }));
}
