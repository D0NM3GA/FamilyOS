"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { setAppOn, type SetAppResult } from "@/lib/app-switches";
import { markSetupReviewed } from "../get-started/review";
import { prisma } from "@/lib/prisma";
import { careHoursFromForm } from "@/lib/pet/stored";

/**
 * Phase 36: one switch on Settings → Apps. Admins only. The app id and on/off arrive from the
 * browser, so lib/app-switches.ts checks them against the switchable list before saving. The
 * rail, Home and every app's own layout read the switches, so the whole app is refreshed.
 */
export async function setAppSwitch(appId: string, on: boolean): Promise<SetAppResult> {
  const admin = await requireAdmin();
  const result = await setAppOn(admin.householdId, appId, on);
  if (result.ok) {
    // Phase 45.4: the checklist's "Pick your apps" is done once an admin has flipped one.
    await markSetupReviewed(admin.householdId, "apps");
    revalidatePath("/", "layout");
  }
  return result;
}

/** Saved, and anything worth saying about what was saved. */
export type CareHoursState = { saved?: boolean; alwaysAsleep?: boolean; leftOut?: number };

/** Phase 47: when the family's pets are awake (admins only). Read leniently: lib/pet/stored.ts. */
export async function setPetCareHours(_prev: CareHoursState, formData: FormData): Promise<CareHoursState> {
  const admin = await requireAdmin();
  const careHours = careHoursFromForm((name) => formData.get(name));
  await prisma.household.update({ where: { id: admin.householdId }, data: { petCareHours: careHours } });
  revalidatePath("/settings/apps");
  revalidatePath("/pet");
  // Stretches someone filled in that didn't make it (ending before they start, say).
  const filledIn = ["weekday", "weekend"].flatMap((day) => [0, 1].filter((i) => formData.get(`${day}-${i}-from`))).length;
  const kept = careHours.weekday.length + careHours.weekend.length;
  return { saved: true, alwaysAsleep: kept === 0, leftOut: Math.max(0, filledIn - kept) };
}
