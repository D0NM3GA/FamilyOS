import { prisma } from "@/lib/prisma";
import { getPointsBalance, getPointsBalances } from "@/lib/tasks/queries";
import { OPEN_STATUSES } from "./rules";

/**
 * Phase 20 Sticker Store reads. Everything returned is already narrowed to plain fields,
 * since most of it ends up in client components (the confirm dialog, the orders panel).
 * Kid-facing reads are keyed by the viewer's own id — never the household's wallets.
 */

export async function getStoreCatalog(householdId: string) {
  const [buckets, rewards] = await Promise.all([
    prisma.rewardBucket.findMany({
      where: { householdId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, emoji: true },
    }),
    prisma.reward.findMany({
      where: { householdId, active: true },
      orderBy: [{ pointCost: "asc" }, { title: "asc" }],
      select: { id: true, title: true, emoji: true, pointCost: true, bucketId: true, limitPerWeek: true, needsApproval: true },
    }),
  ]);
  return { buckets, rewards };
}

/** The viewer's own wallet and saving goal. */
export async function getMyWallet(personId: string) {
  const [balance, me] = await Promise.all([
    getPointsBalance(personId),
    prisma.person.findUnique({
      where: { id: personId },
      select: { savingReward: { select: { id: true, title: true, emoji: true, pointCost: true, active: true } } },
    }),
  ]);
  const goal = me?.savingReward?.active ? me.savingReward : null;
  return { balance, goal: goal ? { id: goal.id, title: goal.title, emoji: goal.emoji, cost: goal.pointCost } : null };
}

const orderFields = {
  id: true,
  title: true,
  emoji: true,
  cost: true,
  status: true,
  note: true,
  createdAt: true,
} as const;

/** Orders paid from this person's stickers: anything still open, plus the last 30 days. */
export async function getMyOrders(personId: string) {
  return prisma.rewardOrder.findMany({
    where: {
      personId,
      OR: [{ status: { in: OPEN_STATUSES } }, { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: orderFields,
  });
}

/** Grown-ups' "Orders to make happen": everything open in the household, oldest first. */
export async function getOpenOrders(householdId: string) {
  const rows = await prisma.rewardOrder.findMany({
    where: { householdId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "asc" },
    select: { ...orderFields, person: { select: { id: true, firstName: true, isHouseholdMember: true } } },
  });
  // Someone who has since left the household keeps their open orders visible (a grown-up
  // can still refund or close them), but labelled.
  return rows.map(({ person, ...o }) => ({
    ...o,
    who: person.isHouseholdMember ? person.firstName : `${person.firstName} (left the household)`,
    whoId: person.id,
  }));
}

/** Grown-ups only: everyone's balance. */
export async function getWallets(householdId: string) {
  const rows = await getPointsBalances(householdId);
  return rows.map(({ person, points }) => ({ id: person.id, firstName: person.firstName, points }));
}

/**
 * The family sticker sheet: every sticker anyone earned this calendar month. Earnings are
 * positive ledger rows that aren't store refunds (orderId null) — not "instanceId set",
 * since deleting a chore nulls that and would silently drop the earnings. Spending never
 * moves it back; undoing a chore does (undo deletes the earning row).
 *
 * The month starts on the server clock, like the rest of the task engine (see
 * lib/household-settings.ts warnIfTimezoneMismatch) — not a new tz-aware helper here.
 */
export async function getFamilySheet(householdId: string, now: Date = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [sum, household] = await Promise.all([
    prisma.pointsLedger.aggregate({
      where: { person: { householdId }, delta: { gt: 0 }, orderId: null, createdAt: { gte: monthStart } },
      _sum: { delta: true },
    }),
    prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { familyGoalStickers: true, familyGoalTitle: true },
    }),
  ]);
  return { earned: sum._sum.delta ?? 0, goal: household.familyGoalStickers, goalTitle: household.familyGoalTitle };
}
