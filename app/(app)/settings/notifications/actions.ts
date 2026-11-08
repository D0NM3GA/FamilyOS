"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { setOthersSignInNotices } from "@/lib/sign-in-notices";
import { z } from "zod";
import { requireAdult } from "@/lib/authz";
import { appOn } from "@/lib/app-switches";
import { listedKinds, nextOff, readReminderPrefs, reminderChannels, saveReminderPrefs, REMINDER_KINDS } from "@/lib/reminders/prefs";
import { parseClock } from "@/lib/reminders/quiet";

const PAGE = "/settings/notifications";

/**
 * Phase 40.2c: an admin's switch for notices about other people's sign-ins (the owner's call:
 * notices about your own always come). Only ever your own switch, on your own profile.
 */
export async function setSignInNotices(on: boolean) {
  if (typeof on !== "boolean") redirect(PAGE);
  const profile = await requireActiveProfile();
  if (!isAdmin(profile) || !(await isSessionOwner(profile))) redirect(PAGE);
  await setOthersSignInNotices(profile.id, on);
  revalidatePath(PAGE);
}

const kindSchema = z.enum(REMINDER_KINDS.map((k) => k.kind) as [string, ...string[]]);

/**
 * Phase 62: a grown-up's own reminder settings: which kinds (only those listed: their app is on),
 * Teams and email (only where they work for this person), and quiet hours (both times, or none).
 */
export async function saveReminders(formData: FormData) {
  const profile = await requireAdult();
  const [medsOn, schoolOn, carsOn] = await Promise.all([appOn(profile.householdId, "meds"), appOn(profile.householdId, "school"), appOn(profile.householdId, "cars")]);
  const listed = listedKinds((app) => (app === "meds" ? medsOn : app === "school" ? schoolOn : carsOn), isAdmin(profile)).map((k) => k.kind);
  const ticked = new Set(formData.getAll("kind").map(String).filter((k) => kindSchema.safeParse(k).success));

  const fromText = String(formData.get("quietFrom") ?? "");
  const toText = String(formData.get("quietTo") ?? "");
  const quietStart = fromText ? parseClock(fromText) : null;
  const quietEnd = toText ? parseClock(toText) : null;
  if ((fromText && quietStart === null) || (toText && quietEnd === null) || (quietStart === null) !== (quietEnd === null)) {
    redirect(`${PAGE}?reminders=quiet#reminders`);
  }

  const channels = await reminderChannels(profile.householdId, profile.id);
  const previous = await readReminderPrefs(profile.id);
  await saveReminderPrefs(profile.id, {
    off: nextOff(previous?.off ?? [], listed, ticked),
    quietStart,
    quietEnd,
    teamsEnabled: channels.teams ? formData.get("teams") === "on" : undefined,
    emailEnabled: channels.email ? formData.get("email") === "on" : undefined,
    digestTeams: channels.teams ? formData.get("digestTeams") === "on" : undefined,
    digestEmail: channels.email ? formData.get("digestEmail") === "on" : undefined,
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?reminders=saved#reminders`);
}

