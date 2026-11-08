import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { isOwnSignIn } from "@/lib/active-profile";
import { appOn } from "@/lib/app-switches";
import { todayCivil } from "./budget";
import { visibleToWhere } from "./gifts";
import { merchantLabel } from "./history";

/**
 * Phase 69c (the owner's call): money in the app's search, for jar members on their own sign-in
 * only. A grown-up who's a household member, on their own sign-in (never a profile switched to
 * with a PIN, never a kid), with Money on; only jars they're in; a surprise stays hidden from
 * whoever it's hidden from. Names, the jar and the date, never an amount. The money gate is
 * checked here rather than with moneyViewer, which would send the whole search page away when
 * Money is off. The search page may read this file and nothing else from Money (eslint.config.mjs).
 */

export type MoneySearchItem = { id: string; label: string; sublabel?: string; href: string };
export type MoneySearchGroup = { title: string; items: MoneySearchItem[] };

const MAX = 10;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function searchMoney(
  viewer: { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null; isHouseholdMember: boolean; authUserId: string | null },
  query: string,
): Promise<MoneySearchGroup[]> {
  const term = query.trim().slice(0, 120);
  if (term.length < 2) return [];
  if (!isAdult(viewer) || !viewer.isHouseholdMember) return [];
  if (!(await isOwnSignIn(viewer))) return [];
  if (!(await appOn(viewer.householdId, "money"))) return [];

  const jars = { householdId: viewer.householdId, members: { some: { personId: viewer.id } } };
  const contains = { contains: term, mode: "insensitive" as const };
  const [charges, bills] = await Promise.all([
    prisma.finTransaction.findMany({
      where: {
        jar: jars,
        state: "ACTIVE",
        AND: [{ OR: [{ merchantName: contains }, { description: contains }, { payee: contains }, { merchantKey: contains }] }, visibleToWhere(viewer.id, todayCivil())],
      },
      select: { id: true, jarId: true, merchantKey: true, merchantName: true, description: true, postedOn: true, jar: { select: { name: true } } },
      orderBy: [{ postedOn: "desc" }, { id: "asc" }],
      take: MAX,
    }),
    prisma.manualBill.findMany({
      where: { jar: jars, name: contains },
      select: { id: true, jarId: true, name: true, jar: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: MAX,
    }),
  ]);

  const groups: MoneySearchGroup[] = [];
  const thisMonth = todayCivil().slice(0, 7);
  if (charges.length) {
    groups.push({
      title: "Money",
      items: charges.map((c) => {
        const day = dayOf(c.postedOn);
        return {
          id: c.id,
          // Never the bank's raw text, which can carry the amount.
          label: c.merchantName || (c.merchantKey && c.merchantKey !== "-" ? merchantLabel(c.merchantKey) : "A charge"),
          sublabel: `${c.jar.name} · ${day}`,
          // The jar's activity on that month.
          // No later than this month: the jar page doesn't open a future one.
          href: `/finances/${c.jarId}?month=${(day.slice(0, 7) > thisMonth ? thisMonth : day.slice(0, 7))}`,
        };
      }),
    });
  }
  if (bills.length) {
    groups.push({
      title: "Bills",
      items: bills.map((b) => ({ id: b.id, label: b.name, sublabel: b.jar.name, href: `/finances/${b.jarId}/bills` })),
    });
  }
  return groups;
}
