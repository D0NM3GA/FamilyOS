"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/lib/active-profile";
import { assertAppOn } from "@/lib/app-guard";
import { setEventDriver } from "@/lib/outlook-copy/drivers";

export type DriverState = { error?: string };

/** Phase 70b: a grown-up says who's driving to an Outlook event (or nobody). */
export async function chooseDriver(_prev: DriverState, formData: FormData): Promise<DriverState> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "calendar");
  const calendarId = String(formData.get("c") ?? "").slice(0, 200);
  const graphId = String(formData.get("g") ?? "").slice(0, 1000);
  const driverId = String(formData.get("driver") ?? "").slice(0, 200) || null;
  const done = await setEventDriver(profile, calendarId, graphId, driverId);
  if (!done.ok) return { error: done.error };
  revalidatePath("/");
  revalidatePath("/calendar");
  redirect(`/calendar?week=${String(formData.get("week") ?? "").replace(/[^0-9-]/g, "").slice(0, 10)}`);
}
