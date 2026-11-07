"use server";

import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { assertAppOn } from "@/lib/app-guard";
import { isAdult } from "@/lib/authz";
import { calendarWriteGranted } from "@/lib/calendar-sync/access";
import { addEventToHomeCalendar } from "@/lib/graph/calendar";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getHouseholdMembers, shortNames } from "@/lib/people";
import { newEventPayload, newEventSchema } from "@/lib/calendar/new-event";
import { signInKind } from "@/lib/sign-in-kind";

export type AddEventState = { ok?: string; error?: string };

/**
 * Phase 64b: a grown-up adds one event to their Outlook calendar (the one this page shows), on
 * their own Microsoft sign-in, once they've granted calendar write access. "Who it's for" must be
 * a household member; their first name goes before the title.
 */
export async function addCalendarEvent(_prev: AddEventState, formData: FormData): Promise<AddEventState> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "calendar");
  if (!isAdult(profile) || !profile.authUserId || !(await isSessionOwner(profile)) || (await signInKind(profile)) !== "microsoft") {
    return { error: "Only a grown-up on their own Microsoft sign-in can add events here." };
  }
  if (!(await calendarWriteGranted(profile.authUserId))) {
    return { error: "Outlook hasn't let the app add events yet. Grant it under Calendar → Outlook sync, then try again." };
  }
  const whoId = String(formData.get("who") ?? "");
  const members = whoId ? await getHouseholdMembers(profile.householdId) : [];
  // The name the picker showed (two people sharing a first name are told apart).
  const who = whoId ? (members.some((m) => m.id === whoId) ? shortNames(members).get(whoId) : undefined) : "";
  if (who === undefined) return { error: "Pick someone from the family, or no one." };
  const parsed = newEventSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    day: String(formData.get("day") ?? ""),
    start: String(formData.get("start") ?? ""),
    end: String(formData.get("end") ?? ""),
    who,
    transactionId: String(formData.get("transactionId") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const zone = (await getHouseholdSettings(profile.householdId)).timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const result = await addEventToHomeCalendar(profile.authUserId, profile.homeCalendarId, newEventPayload(parsed.data, zone));
  if (!result.ok) return { error: result.error };
  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: `Added "${parsed.data.title}" to your Outlook calendar.` };
}
