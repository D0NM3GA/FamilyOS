"use server";

import { redirect } from "next/navigation";
import { getEntraRole, setActiveProfileCookie } from "@/lib/active-profile";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { syncServerZone } from "@/lib/household-zone";
import { createSetupToken, finishDetailsSchema, finishSetup, isSetUp, readFinishDetails, SetupError, setupDetailsSchema } from "@/lib/setup";
import { canonicalizeTimeZone } from "@/lib/household-settings";
import { SETUP_PATH } from "@/lib/setup-checklist";

/**
 * Phase 40.1c: setting up a new install (lib/setup.ts has the two steps). These run before
 * anyone is signed in (the first) or right after setup's own sign-in (the second); both refuse
 * once a household exists.
 */

export type SetupState = { error?: string; token?: string };

/** Step 1: checks the form and hands back the single-use token for the first passkey. */
export async function startSetup(_prev: SetupState, formData: FormData): Promise<SetupState> {
  if (await isSetUp()) return { error: "This app is already set up. Sign in instead." };
  const parsed = setupDetailsSchema.safeParse({
    householdName: String(formData.get("householdName") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  try {
    return { token: await createSetupToken(parsed.data) };
  } catch (err) {
    if (err instanceof SetupError) return { error: err.message };
    throw err;
  }
}

export type FinishState = { error?: string };

/**
 * Step 2: makes the household and the signed-in person its Admin. The details come from step 1
 * (kept for an hour) or, for a Microsoft setup or after that hour, from the form. A Microsoft
 * sign-in must have the Admin role in Entra, which stays the source of truth for its role.
 */
export async function completeSetup(_prev: FinishState, formData: FormData): Promise<FinishState> {
  const session = await getServerSession();
  if (!session) redirect("/setup");
  if (await isSetUp()) redirect("/profiles");

  const microsoft = (await prisma.account.count({ where: { userId: session.user.id, providerId: "microsoft" } })) > 0;
  if (microsoft && (await getEntraRole(session.user.id)) !== "ADMIN") {
    return { error: "Your Microsoft account needs the Admin role for this app in Entra to set it up." };
  }

  const kept = await readFinishDetails(session.user.id);
  const parsed = kept
    ? { success: true as const, data: kept }
    : finishDetailsSchema.safeParse({ householdName: String(formData.get("householdName") ?? ""), firstName: String(formData.get("firstName") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  let adminId: string;
  try {
    // Phase 45.2: the device's own zone, sent by the form; anything unrecognised is just left unset.
    const timezone = canonicalizeTimeZone(String(formData.get("timezone") ?? "").slice(0, 64));
    adminId = await finishSetup({ id: session.user.id, email: session.user.email ?? null }, parsed.data, timezone);
    // Phase 49: from here on the server keeps the household's time.
    await syncServerZone();
  } catch (err) {
    if (err instanceof SetupError) return { error: err.message };
    throw err;
  }
  // Fixed text only: no household or person names in logs.
  console.info("[setup] This install has been set up.");
  // Phase 45.4: straight into the guided setup, as the new admin (they just signed in, so their
  // own tile needs no PIN): no stop at the profile picker.
  await setActiveProfileCookie(adminId);
  redirect(SETUP_PATH);
}
