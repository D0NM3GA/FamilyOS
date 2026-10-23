"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { getGraphToken, graphRequest } from "@/lib/graph/client";
import { calendarWriteGranted } from "@/lib/calendar-sync/access";
import { graphWithToken } from "@/lib/calendar-sync/auto";
import { runSync } from "@/lib/calendar-sync/run";
import { captureError } from "@/lib/observability";
import { signInKind } from "@/lib/sign-in-kind";

/**
 * Calendar write-back (Phase 17). Connecting takes an admin who is the Microsoft-signed-in
 * person themselves, since the calendar is made in, and written with, their own mailbox;
 * after that, only that owner can sync, change or disconnect it.
 */
export type CalendarFormState = { error?: string; notice?: string };

const nameSchema = z.string().trim().min(1, "Give the calendar a name").max(100);

async function requireConnectingAdmin() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile) || !profile.authUserId || !(await isSessionOwner(profile))) return null;
  // Phase 40.1b: the calendar lives in a Microsoft mailbox, so a passkey sign-in can't connect it.
  if ((await signInKind(profile)) !== "microsoft") return null;
  return profile;
}

async function requireOwner() {
  const profile = await requireActiveProfile();
  if (!(await isSessionOwner(profile))) return null;
  const sync = await prisma.calendarSync.findUnique({ where: { householdId: profile.householdId } });
  if (!sync || sync.ownerPersonId !== profile.id) return null;
  return { profile, sync };
}

function describe(result: Awaited<ReturnType<typeof runSync>>): CalendarFormState {
  if (result.status === "skipped") {
    if (result.reason === "off") return { error: "Calendar is turned off for your family, so the Outlook sync is paused." };
    return { error: result.reason === "busy" ? "A sync is already running. Try again in a minute." : "Not connected." };
  }
  if (result.error) return { error: result.error };
  const done = `${result.created} added, ${result.updated} updated, ${result.deleted} removed.`;
  return { notice: result.remaining ? `${done} ${result.remaining} more on the next sync.` : `Up to date. ${done}` };
}

/**
 * Incremental consent: asks Microsoft for one more permission, Calendars.ReadWrite, on top of
 * the usual ones (every other sign-in keeps asking only for read access, so a tenant that
 * hasn't approved writing can't break anyone's sign-in). Phase 40.1a: through Better Auth's
 * link flow, the one that records newly granted scopes on the account (1.7 no longer does on a
 * plain sign-in); it re-links the signed-in person's own Microsoft account and nothing else.
 * Server-side, so `/link-social` stays closed to the browser.
 */
export async function grantCalendarAccess(): Promise<CalendarFormState> {
  const profile = await requireConnectingAdmin();
  if (!profile) return { error: "Only an admin signed in with Microsoft (not a switched profile) can connect the calendar." };
  let url: string;
  try {
    const result = await auth.api.linkSocialAccount({
      body: { provider: "microsoft", scopes: ["Calendars.ReadWrite"], callbackURL: "/calendar/outlook", errorCallbackURL: "/calendar/outlook?grant=failed" },
      headers: await headers(),
    });
    url = result.url;
  } catch (err) {
    captureError(err);
    return { error: "Couldn't start the Microsoft sign-in. Try again." };
  }
  redirect(url);
}

export async function connectCalendar(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const profile = await requireConnectingAdmin();
  if (!profile) return { error: "Only an admin signed in with Microsoft (not a switched profile) can connect the calendar." };
  if (await prisma.calendarSync.findUnique({ where: { householdId: profile.householdId } })) return { error: "Already connected." };
  if (!(await calendarWriteGranted(profile.authUserId!))) return { error: "Grant calendar access first." };
  const name = nameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Invalid name" };

  let token: string;
  try {
    token = await getGraphToken();
  } catch {
    return { error: "Couldn't reach Microsoft with your sign-in. Sign out and back in, then try again." };
  }
  const res = await graphRequest(token, "POST", "/me/calendars", { name: name.data });
  if (res.status === 409) return { error: "Outlook already has a calendar with that name. Pick another name." };
  const calendarId = (res.json as { id?: unknown } | null)?.id;
  if (res.status === 401 || res.status === 403) return { error: "Microsoft said no. Grant calendar access, then try again." };
  if (res.status >= 400 || typeof calendarId !== "string") return { error: "Outlook didn't create the calendar. Try again." };

  let sync;
  try {
    sync = await prisma.calendarSync.create({
      data: { householdId: profile.householdId, ownerPersonId: profile.id, calendarId, calendarName: name.data },
    });
  } catch (err) {
    // A second Connect raced this one and won: don't leave this calendar behind in Outlook.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await graphRequest(token, "DELETE", `/me/calendars/${encodeURIComponent(calendarId)}`).catch(() => {});
      return { error: "Already connected." };
    }
    throw err;
  }
  let state: CalendarFormState;
  try {
    state = describe(await runSync({ syncId: sync.id, graph: graphWithToken(token) }));
  } catch (err) {
    captureError(err);
    state = { error: "Connected, but the first sync failed. Try Sync now." };
  }
  revalidatePath("/calendar/outlook");
  return state.error ? state : { notice: `Connected "${name.data}". ${state.notice ?? ""}` };
}

export async function syncNow(): Promise<CalendarFormState> {
  const owner = await requireOwner();
  if (!owner) return { error: "Only the person who connected the calendar can sync it, from their own signed-in profile." };
  let token: string;
  try {
    token = await getGraphToken();
  } catch {
    return { error: "Couldn't reach Microsoft with your sign-in. Sign out and back in, then try again." };
  }
  let state: CalendarFormState;
  try {
    state = describe(await runSync({ syncId: owner.sync.id, graph: graphWithToken(token) }));
  } catch (err) {
    captureError(err);
    await prisma.calendarSync.updateMany({ where: { id: owner.sync.id }, data: { leaseUntil: null } });
    state = { error: "The sync failed. Try again in a few minutes." };
  }
  revalidatePath("/calendar/outlook");
  return state;
}

export async function updateCalendarOptions(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const owner = await requireOwner();
  if (!owner) return { error: "Only the person who connected the calendar can change it." };
  const on = (name: string) => formData.get(name) === "on";
  await prisma.calendarSync.update({
    where: { id: owner.sync.id },
    // Home's next visit applies the change (autoSyncDue), and the last result stays shown.
    data: {
      includeDates: on("includeDates"),
      includeVehicles: on("includeVehicles"),
      includeChores: on("includeChores"),
      includeMeds: on("includeMeds"),
      includeSchoolTasks: on("includeSchoolTasks"),
      includeAssignments: on("includeAssignments"),
      optionsChangedAt: new Date(),
    },
  });
  revalidatePath("/calendar/outlook");
  return { notice: "Saved. Sync now to apply it right away." };
}

/**
 * Deletes the app's calendar from Outlook (events and sharing with it; it only ever held
 * app-made events) and forgets it. One Graph call, so it can't stall partway like deleting
 * events one by one would.
 */
export async function disconnectCalendar(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const owner = await requireOwner();
  if (!owner) return { error: "Only the person who connected the calendar can disconnect it." };
  if (formData.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  let token: string;
  try {
    token = await getGraphToken();
  } catch {
    return { error: "Couldn't reach Microsoft with your sign-in. Sign out and back in, then try again." };
  }
  const res = await graphRequest(token, "DELETE", `/me/calendars/${encodeURIComponent(owner.sync.calendarId)}`);
  // Refused (access revoked): still let go of it here, and say what's left to do by hand.
  const refused = res.status === 401 || res.status === 403;
  if (res.status >= 400 && res.status !== 404 && !refused) return { error: "Outlook didn't delete the calendar. Try again." };
  await prisma.calendarSync.delete({ where: { id: owner.sync.id } });
  revalidatePath("/calendar/outlook");
  return {
    notice: refused
      ? `Disconnected. Microsoft wouldn't let the app delete "${owner.sync.calendarName}", so delete it in Outlook yourself.`
      : "Disconnected, and the calendar was removed from Outlook.",
  };
}

/**
 * Any admin: stop using the calendar without touching Outlook. The way out when its owner
 * can't (left the household, lost their Microsoft sign-in): otherwise the household would
 * be stuck with a calendar no one can sync or disconnect. The calendar stays in the owner's
 * Outlook for them to delete.
 */
export async function forgetCalendar(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) return { error: "Only an admin can do that." };
  if (formData.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  await prisma.calendarSync.deleteMany({ where: { householdId: profile.householdId } });
  revalidatePath("/calendar/outlook");
  return { notice: "The app has stopped updating that calendar. It's still in its owner's Outlook." };
}
