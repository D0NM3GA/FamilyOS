"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { signInKind } from "@/lib/sign-in-kind";
import { listMyCalendars } from "@/lib/graph/calendar";

/**
 * Phase 45.2: picks the Outlook calendar Home and Calendar show, for the grown-up signed in
 * with Microsoft as themselves (Graph tokens are per sign-in). The id must be one of their own
 * calendars right now; empty goes back to the install's default.
 */
export async function chooseHomeCalendar(formData: FormData): Promise<void> {
  const profile = await requireActiveProfile();
  if (!isAdult(profile) || !(await isSessionOwner(profile)) || (await signInKind(profile)) !== "microsoft") {
    redirect("/settings/calendar-on-home");
  }
  const id = String(formData.get("calendarId") ?? "").slice(0, 512);
  if (id) {
    const mine = await listMyCalendars();
    // Codes, not text: the page maps them to fixed words, so the address can't put words on screen.
    if (!mine.ok) redirect("/settings/calendar-on-home?error=outlook");
    if (!mine.calendars.some((c) => c.id === id)) redirect("/settings/calendar-on-home?error=notYours");
  }
  await prisma.person.update({ where: { id: profile.id }, data: { homeCalendarId: id || null } });
  revalidatePath("/", "layout");
  redirect("/settings/calendar-on-home?saved=1");
}
