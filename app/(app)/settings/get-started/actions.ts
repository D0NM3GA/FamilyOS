"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdult } from "@/lib/authz";
import { SETUP_PATH } from "@/lib/setup-checklist";
import { markSetupReviewed } from "./review";
import { nextStep } from "./steps";

/**
 * Phase 45.4: the guided setup's own actions. Everything a step changes goes through the
 * page's existing actions (home, the look, apps, phones); these only move along, add someone,
 * and hide or show the checklist card.
 */

/** Continue: notes the step as seen (only "look" and "apps" need it) and goes to the next. */
export async function continueSetup(step: string): Promise<void> {
  const admin = await requireAdmin();
  await markSetupReviewed(admin.householdId, step);
  revalidatePath("/settings", "layout");
  redirect(`${SETUP_PATH}?step=${nextStep(step)}`);
}

export type AddMemberState = { error?: string; added?: { name: string; kind: "kid" | "adult" | "contact" }; at?: number };

const memberSchema = z.object({
  firstName: z.string().trim().min(1, "Their first name, please.").max(40, "Keep the first name to 40 characters."),
  kind: z.enum(["kid", "adult", "contact"]),
});

/**
 * Adds someone from the guided setup: a kid (a picker tile), a grown-up (a household member,
 * invited to sign in on their own at the end) or a grandparent or helper (a contact, no tile).
 * Admins only, like Settings → Household's "+ Add member".
 */
export async function addFamilyMember(_prev: AddMemberState, formData: FormData): Promise<AddMemberState> {
  const admin = await requireAdmin();
  const parsed = memberSchema.safeParse({ firstName: String(formData.get("firstName") ?? ""), kind: String(formData.get("kind") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { firstName, kind } = parsed.data;
  await prisma.person.create({
    data: {
      householdId: admin.householdId,
      firstName,
      isHouseholdMember: kind !== "contact",
      role: kind === "kid" ? "KID" : kind === "adult" ? "ADULT" : null,
    },
  });
  revalidatePath("/settings", "layout");
  return { added: { name: firstName, kind }, at: Date.now() };
}

/** Hides the "Finish setting up" card on Settings, for this grown-up only, until shown again. */
export async function hideSetupCard(): Promise<void> {
  const profile = await requireAdult();
  await prisma.person.update({ where: { id: profile.id }, data: { setupCardHidden: true } });
  revalidatePath("/settings");
}

export async function showSetupCard(): Promise<void> {
  const profile = await requireAdult();
  await prisma.person.update({ where: { id: profile.id }, data: { setupCardHidden: false } });
  revalidatePath("/settings");
}
