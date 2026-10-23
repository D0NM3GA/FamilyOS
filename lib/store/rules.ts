import type { RewardOrderStatus } from "@/app/generated/prisma/enums";
import { DEFAULT_REWARD_WORDS, type RewardWords } from "@/lib/reward-words";

/**
 * Phase 20 Sticker Store rules — pure (no prisma), so they're unit-testable and the client
 * confirm dialog can import them. The form schemas live in ./forms.ts, so the shelf's
 * client bundle doesn't carry zod.
 */

/** Whether a balance covers a cost. A negative balance (undo after spending) never does. */
export function canAfford(balance: number, cost: number): boolean {
  return balance >= cost;
}

/** Stickers still needed to afford something; 0 when it's affordable. */
export function moreNeeded(balance: number, cost: number): number {
  return Math.max(0, cost - balance);
}

/** A rolling-7-day limit (tz-free on purpose). `limit` null = any time. */
export function weekLimitReached(boughtLast7Days: number, limit: number | null): boolean {
  return limit !== null && boughtLast7Days >= limit;
}

/** A grown-up placing an order is the OK, so only a kid's order of a needs-OK reward waits. */
export function initialStatus(opts: { needsApproval: boolean; placedByAdult: boolean }): "WAITING_OK" | "TO_DO" {
  return opts.needsApproval && !opts.placedByAdult ? "WAITING_OK" : "TO_DO";
}

export type OrderAction = "approve" | "decline" | "deliver" | "refund";

/**
 * Every allowed transition, and whether it gives the stickers back. Anything else is
 * "already handled". DELIVERED can't be refunded in v1: once it's handed over, it's done.
 * Approve never touches the ledger — the stickers were already held at placement.
 */
export const TRANSITIONS: Record<OrderAction, { from: RewardOrderStatus; to: RewardOrderStatus; refund: boolean }> = {
  approve: { from: "WAITING_OK", to: "TO_DO", refund: false },
  decline: { from: "WAITING_OK", to: "DECLINED", refund: true },
  deliver: { from: "TO_DO", to: "DELIVERED", refund: false },
  refund: { from: "TO_DO", to: "REFUNDED", refund: true },
};

export const OPEN_STATUSES: RewardOrderStatus[] = ["WAITING_OK", "TO_DO"];
/** Orders that count toward a week limit — a declined or refunded one doesn't. */
export const LIMIT_STATUSES: RewardOrderStatus[] = ["WAITING_OK", "TO_DO", "DELIVERED"];

export function limitLabel(limit: number | null): string {
  if (limit === null) return "Any time";
  return `${limit} a week`;
}

/** The family sheet's fill, 0–1, or null when no goal is set. */
export function familySheetFill(earned: number, goal: number | null): number | null {
  if (!goal) return null;
  return Math.min(1, Math.max(0, earned / goal));
}

/** The kid-facing tracker label for an order's status. */
export function trackerLabel(status: RewardOrderStatus, words: RewardWords = DEFAULT_REWARD_WORDS): string {
  switch (status) {
    case "WAITING_OK":
      return "Waiting for an OK";
    case "TO_DO":
      return "On its way";
    case "DELIVERED":
      return "Done";
    case "DECLINED":
      return `Not this time · ${words.many} back`;
    case "REFUNDED":
      return `Refunded · ${words.many} back`;
  }
}
