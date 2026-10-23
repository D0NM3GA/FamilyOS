"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { deliverOrderAlerts } from "@/lib/alerts/dispatch";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult } from "@/lib/authz";
import { actOnOrder, placeOrder } from "@/lib/store/orders";
import { adjustStickers, MAX_ADJUSTMENT } from "@/lib/store/ledger";
import { bucketSchema, familyGoalSchema, rewardSchema } from "@/lib/store/forms";
import type { OrderAction } from "@/lib/store/rules";

/**
 * Phase 20 Sticker Store actions. Thin wrappers: authorization and every sticker movement
 * live in lib/store/orders.ts; these parse input and refresh the pages that show balances
 * (store, chores/meds pills, Home's orders card, and the layout's bell).
 */
function refreshStore() {
  revalidatePath("/points");
  revalidatePath("/chores");
  revalidatePath("/meds");
  revalidatePath("/", "layout");
}

export async function buyReward(rewardId: string, forPersonId?: string | null) {
  const profile = await requireActiveProfile();
  const result = await placeOrder(profile, z.string().min(1).parse(rewardId), forPersonId || null);
  // Phase 21: Teams/email alerts go out after the response, and only for an order that
  // committed — placeOrder's transaction has resolved by here.
  if ("orderId" in result) after(() => deliverOrderAlerts(result.orderId));
  refreshStore();
  return result;
}

const orderAction = z.enum(["approve", "decline", "deliver", "refund"]);

export async function handleOrder(orderId: string, action: OrderAction, note?: string) {
  const profile = await requireAdult();
  const result = await actOnOrder(
    profile,
    z.string().min(1).parse(orderId),
    orderAction.parse(action),
    z.string().trim().max(200).optional().parse(note) || null,
  );
  refreshStore();
  return result;
}

/** Anyone may pick (or clear) the reward they're saving up for — their own goal only. */
export async function setSavingGoal(rewardId: string | null) {
  const profile = await requireActiveProfile();
  if (rewardId) {
    const reward = await prisma.reward.findFirst({ where: { id: rewardId, householdId: profile.householdId, active: true } });
    if (!reward) return;
  }
  await prisma.person.update({ where: { id: profile.id }, data: { savingRewardId: rewardId || null } });
  revalidatePath("/points");
  revalidatePath("/");
}

// ---------- Stocking the store (grown-ups) ----------

export type FormState = { error?: string; ok?: boolean };

function rewardInput(formData: FormData) {
  return rewardSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    pointCost: String(formData.get("pointCost") ?? ""),
    emoji: String(formData.get("emoji") ?? ""),
    bucketId: String(formData.get("bucketId") ?? ""),
    limitPerWeek: String(formData.get("limitPerWeek") ?? ""),
    needsApproval: formData.get("needsApproval") === "on",
  });
}

async function bucketBelongs(householdId: string, bucketId: string | null) {
  if (!bucketId) return true;
  return (await prisma.rewardBucket.count({ where: { id: bucketId, householdId } })) === 1;
}

function duplicateTitle(err: unknown) {
  // The unique constraint covers inactive rows too, so point at where the old one is.
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function saveReward(rewardId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireAdult();
  const parsed = rewardInput(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { title, pointCost, emoji, bucketId, limitPerWeek, needsApproval } = parsed.data;
  if (!(await bucketBelongs(profile.householdId, bucketId))) return { error: "That shelf doesn't exist." };
  const data = { title, pointCost, emoji, bucketId, limitPerWeek, needsApproval };

  try {
    if (rewardId) {
      const res = await prisma.reward.updateMany({ where: { id: rewardId, householdId: profile.householdId }, data });
      if (res.count !== 1) return { error: "Reward not found." };
    } else {
      await prisma.reward.create({ data: { householdId: profile.householdId, ...data } });
    }
  } catch (err) {
    if (duplicateTitle(err)) return { error: "A reward with that title already exists (it may be switched off below)." };
    throw err;
  }
  revalidatePath("/points");
  revalidatePath("/points/manage");
  return { ok: true };
}

/** No delete — switch off, so past orders and ledger reasons still read sensibly. */
export async function setRewardActive(rewardId: string, active: boolean) {
  const profile = await requireAdult();
  await prisma.reward.updateMany({ where: { id: rewardId, householdId: profile.householdId }, data: { active } });
  revalidatePath("/points");
  revalidatePath("/points/manage");
}

export async function saveBucket(bucketId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireAdult();
  const parsed = bucketSchema.safeParse({ name: String(formData.get("name") ?? ""), emoji: String(formData.get("emoji") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    if (bucketId) {
      const res = await prisma.rewardBucket.updateMany({ where: { id: bucketId, householdId: profile.householdId }, data: parsed.data });
      if (res.count !== 1) return { error: "Shelf not found." };
    } else {
      await prisma.rewardBucket.create({ data: { householdId: profile.householdId, ...parsed.data } });
    }
  } catch (err) {
    if (duplicateTitle(err)) return { error: "There's already a shelf with that name." };
    throw err;
  }
  revalidatePath("/points");
  revalidatePath("/points/manage");
  return { ok: true };
}

/** Only an empty shelf can go — checked in the same statement, so it can't race an add. */
export async function deleteBucket(bucketId: string): Promise<FormState> {
  const profile = await requireAdult();
  const res = await prisma.rewardBucket.deleteMany({
    where: { id: bucketId, householdId: profile.householdId, rewards: { none: {} } },
  });
  revalidatePath("/points");
  revalidatePath("/points/manage");
  return res.count === 1 ? { ok: true } : { error: "Move its rewards to another shelf first (switched-off ones count too)." };
}

export async function saveFamilyGoal(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireAdult();
  const parsed = familyGoalSchema.safeParse({
    stickers: String(formData.get("stickers") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await prisma.household.update({
    where: { id: profile.householdId },
    data: { familyGoalStickers: parsed.data.stickers, familyGoalTitle: parsed.data.title },
  });
  revalidatePath("/points");
  revalidatePath("/points/manage");
  return { ok: true };
}

// ---------- Bonus and take-back (grown-ups) ----------

const adjustmentInput = z.object({
  direction: z.enum(["give", "take"]),
  amount: z.coerce.number().int().min(1, "At least 1").max(MAX_ADJUSTMENT, `At most ${MAX_ADJUSTMENT} at a time`),
  reason: z.string().trim().min(1, "Say what it's for").max(80, "Keep it short"),
});

export type AdjustState = { error?: string; saved?: number };

/** "Helped Grandma move: +10 ⭐", or some taken back. Shows in their sticker history. */
export async function adjustStickersAction(personId: string, _prev: AdjustState, formData: FormData): Promise<AdjustState> {
  const profile = await requireAdult();
  const parsed = adjustmentInput.safeParse({
    direction: formData.get("direction"),
    amount: formData.get("amount"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { direction, amount, reason } = parsed.data;
  const result = await adjustStickers(profile, {
    personId: z.string().min(1).parse(personId),
    delta: direction === "give" ? amount : -amount,
    reason,
  });
  if ("error" in result) return { error: result.error };
  refreshStore();
  revalidatePath("/points/history");
  return { saved: Date.now() };
}
