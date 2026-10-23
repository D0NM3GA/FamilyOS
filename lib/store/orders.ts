import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { notifyAdmins, notifyPerson } from "@/lib/notifications";
import { getRewardWords } from "@/lib/household-settings";
import { DEFAULT_REWARD_WORDS, rewardCount, type RewardWords } from "@/lib/reward-words";
import { LIMIT_STATUSES, TRANSITIONS, canAfford, initialStatus, weekLimitReached, type OrderAction } from "./rules";

/**
 * Phase 20 Sticker Store orders — the only code that moves stickers for the store.
 * Callers (app/(app)/points/actions.ts) pass the active profile; everything is re-checked
 * here, so a crafted request can't buy for someone else or act on another household.
 */

type Actor = { id: string; householdId: string; firstName: string; role: "ADULT" | "KID" | "ADMIN" | null };

export type PlaceResult = { error: string } | { orderId: string; status: "WAITING_OK" | "TO_DO" };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Buys a reward with someone's stickers. A kid buys only for themselves; a grown-up may buy
 * for any household member (e.g. handing a prize over in person). The stickers come off
 * right away, including for a needs-OK order (they're "held"; a decline gives them back).
 *
 * Everything that reads the wallet — balance and the week limit — runs under the same
 * per-wallet advisory lock the old redeem used, so two taps (or two devices) can't both
 * pass the checks before either writes.
 */
export async function placeOrder(actor: Actor, rewardId: string, forPersonId?: string | null): Promise<PlaceResult> {
  const adult = isAdult(actor);
  const walletId = forPersonId ?? actor.id;
  const words = await getRewardWords(actor.householdId);
  if (!adult && walletId !== actor.id) return { error: `You can only spend your own ${words.many}.` };

  const [reward, wallet] = await Promise.all([
    prisma.reward.findFirst({ where: { id: rewardId, householdId: actor.householdId, active: true } }),
    prisma.person.findFirst({
      where: { id: walletId, householdId: actor.householdId, isHouseholdMember: true },
      select: { id: true, firstName: true },
    }),
  ]);
  if (!reward) return { error: "That reward isn't in the store anymore." };
  if (!wallet) return { error: "Person not found." };

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${wallet.id}))`;

    if (reward.limitPerWeek !== null) {
      const recent = await tx.rewardOrder.count({
        where: {
          personId: wallet.id,
          rewardId: reward.id,
          status: { in: LIMIT_STATUSES },
          createdAt: { gte: new Date(Date.now() - WEEK_MS) },
        },
      });
      if (weekLimitReached(recent, reward.limitPerWeek)) {
        return { error: `That one's limited to ${reward.limitPerWeek} a week. Try again in a few days!` };
      }
    }

    const sum = await tx.pointsLedger.aggregate({ where: { personId: wallet.id }, _sum: { delta: true } });
    const balance = sum._sum.delta ?? 0;
    if (!canAfford(balance, reward.pointCost)) {
      return { error: `${wallet.id === actor.id ? "You have" : `${wallet.firstName} has`} ${rewardCount(balance, words)} — this costs ${reward.pointCost}.` };
    }

    const status = initialStatus({ needsApproval: reward.needsApproval, placedByAdult: adult });
    const order = await tx.rewardOrder.create({
      data: {
        householdId: actor.householdId,
        rewardId: reward.id,
        personId: wallet.id,
        placedById: actor.id,
        title: reward.title,
        emoji: reward.emoji,
        cost: reward.pointCost,
        status,
      },
    });
    await tx.pointsLedger.create({
      data: { personId: wallet.id, delta: -reward.pointCost, reason: reward.title, orderId: order.id },
    });

    const what = `${reward.emoji ? `${reward.emoji} ` : ""}${reward.title}`;
    await notifyAdmins(tx, actor.householdId, actor.id, {
      kind: status === "WAITING_OK" ? "ORDER_NEEDS_OK" : "ORDER_PLACED",
      title:
        status === "WAITING_OK"
          ? `${wallet.firstName} wants ${what} · ${rewardCount(reward.pointCost, words)} · needs your OK`
          : `${wallet.firstName} bought ${what} · ${rewardCount(reward.pointCost, words)}`,
      href: "/points#orders",
      orderId: order.id,
    });

    return { orderId: order.id, status };
  });
}

/**
 * A grown-up approves, declines, delivers or refunds. The status flip is a guarded
 * updateMany (only from the expected status), and the credit for a decline/refund is
 * written in the same transaction ONLY when that flip actually happened — so a double tap,
 * or two grown-ups at once, moves the stickers exactly once and the loser hears "already
 * handled".
 */
export async function actOnOrder(actor: Actor, orderId: string, action: OrderAction, note?: string | null) {
  if (!isAdult(actor)) return { error: "Only grown-ups can do that." };
  const words = await getRewardWords(actor.householdId);
  const t = TRANSITIONS[action];
  const now = new Date();
  const decided = action === "approve" || action === "decline";

  return prisma.$transaction(async (tx) => {
    const flipped = await tx.rewardOrder.updateMany({
      where: { id: orderId, householdId: actor.householdId, status: t.from },
      data: {
        status: t.to,
        ...(note ? { note } : {}),
        ...(decided ? { decidedAt: now, decidedById: actor.id } : { closedAt: now, closedById: actor.id }),
      },
    });
    if (flipped.count !== 1) return { error: "Someone already handled that one." };

    const order = await tx.rewardOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (t.refund) {
      await tx.pointsLedger.create({
        data: {
          personId: order.personId,
          delta: order.cost,
          reason: `${action === "decline" ? "Not this time" : "Refund"}: ${order.title}`,
          orderId: order.id,
        },
      });
    }
    // The kid hears how it went (grown-ups already hear about new orders); not a grown-up
    // acting on their own order.
    if (order.personId !== actor.id) {
      await notifyPerson(tx, {
        householdId: actor.householdId,
        recipientId: order.personId,
        kind: "ORDER_UPDATED",
        title: orderUpdateTitle(action, `${order.emoji ? `${order.emoji} ` : ""}${order.title}`, order.cost, words),
        href: "/points",
      });
    }
    return {};
  });
}

/** What the kid's bell says when a grown-up handles their order. */
export function orderUpdateTitle(action: OrderAction, what: string, cost: number, words: RewardWords = DEFAULT_REWARD_WORDS): string {
  switch (action) {
    case "approve":
      return `${what} got an OK! A grown-up will make it happen.`;
    case "decline":
      return `Not this time for ${what}. Your ${rewardCount(cost, words)} ${Math.abs(cost) === 1 ? "is" : "are"} back.`;
    case "deliver":
      return `${what} is here! Enjoy 🎉`;
    case "refund":
      return `${what} was refunded: ${rewardCount(cost, words)} back.`;
  }
}
