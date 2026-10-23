import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { getRewardWords } from "@/lib/household-settings";
import { capitalized, DEFAULT_REWARD_WORDS, rewardCount, type RewardWords } from "@/lib/reward-words";

/**
 * A person's sticker history: every row of their ledger, read back as what happened. The
 * ledger is the one source of truth for stickers (chores, meds, store orders and their
 * refunds, and a grown-up's bonus or take-back), so the history and the balance can't disagree.
 */

export type LedgerKind = "chore" | "med" | "order" | "refund" | "bonus" | "taken";

export type LedgerRow = { id: string; delta: number; kind: LedgerKind; label: string; createdAt: Date };

type RawRow = {
  id: string;
  delta: number;
  reason: string | null;
  createdAt: Date;
  orderId: string | null;
  instance: { definition: { domain: "CHORE" | "MED" | "VEHICLE" } } | null;
};

/** Pure: what one ledger row was. */
export function describeLedgerRow(row: RawRow, words: RewardWords = DEFAULT_REWARD_WORDS): LedgerRow {
  const label = row.reason?.trim() || capitalized(words.many);
  const kind: LedgerKind = row.orderId
    ? row.delta < 0
      ? "order"
      : "refund"
    : row.instance
      ? row.instance.definition.domain === "MED"
        ? "med"
        : "chore"
      : row.delta < 0
        ? "taken"
        : "bonus";
  return { id: row.id, delta: row.delta, kind, label, createdAt: row.createdAt };
}

export async function getStickerHistory(personId: string, words: RewardWords = DEFAULT_REWARD_WORDS, take = 100): Promise<LedgerRow[]> {
  const rows = await prisma.pointsLedger.findMany({
    where: { personId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      delta: true,
      reason: true,
      createdAt: true,
      orderId: true,
      instance: { select: { definition: { select: { domain: true } } } },
    },
  });
  return rows.map((row) => describeLedgerRow(row, words));
}

/** Biggest single bonus or take-back: a typo shouldn't wipe out a month of chores. */
export const MAX_ADJUSTMENT = 500;

type Actor = { id: string; householdId: string; firstName: string; role: "ADULT" | "KID" | "ADMIN" | null };

/**
 * A grown-up gives a bonus ("helped Grandma move") or takes some back. Only for household
 * members of the actor's own household; never for themselves (no paying yourself in stickers).
 */
export async function adjustStickers(actor: Actor, input: { personId: string; delta: number; reason: string }) {
  if (!isAdult(actor)) return { error: "Only grown-ups can do that." } as const;
  const words = await getRewardWords(actor.householdId);
  if (input.personId === actor.id) return { error: `${capitalized(words.many)} are for someone else.` } as const;
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_ADJUSTMENT) {
    return { error: `Pick a number from 1 to ${MAX_ADJUSTMENT}.` } as const;
  }
  const person = await prisma.person.findFirst({
    where: { id: input.personId, householdId: actor.householdId, isHouseholdMember: true },
    select: { id: true },
  });
  if (!person) return { error: "That person isn't in the family." } as const;
  const n = Math.abs(input.delta);
  await prisma.$transaction([
    prisma.pointsLedger.create({ data: { personId: person.id, delta: input.delta, reason: input.reason } }),
    // So a take-back is never a mystery, and a bonus is a nice surprise in the bell.
    prisma.notification.create({
      data: {
        householdId: actor.householdId,
        recipientId: person.id,
        kind: "STICKERS_ADJUSTED",
        title:
          input.delta > 0
            ? `🌟 +${rewardCount(n, words)} from ${actor.firstName}: ${input.reason}`
            : `${actor.firstName} took back ${rewardCount(n, words)}: ${input.reason}`,
        href: "/points/history",
      },
    }),
  ]);
  return { ok: true } as const;
}
