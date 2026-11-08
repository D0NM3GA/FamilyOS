"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { getServerSession } from "@/lib/session";
import { signOutMyOtherSessions, signOutMySession } from "@/lib/my-sessions";

const PAGE = "/settings/devices";

/**
 * Phase 67a: the signed-in person, on their own profile (not a PIN-switch onto it), and the
 * session doing the asking, which is never signed out from here.
 */
async function me() {
  const profile = await requireActiveProfile();
  const session = await getServerSession();
  if (!session || !(await isSessionOwner(profile))) redirect(PAGE);
  return { userId: session.user.id, currentSessionId: session.session.id, person: { id: profile.id, firstName: profile.firstName, householdId: profile.householdId } };
}

export async function signOutDevice(sessionId: string) {
  const who = await me();
  if (typeof sessionId === "string" && sessionId.length <= 64) await signOutMySession(who, sessionId);
  revalidatePath(PAGE);
  redirect(PAGE);
}

export async function signOutEverywhereElse() {
  const who = await me();
  await signOutMyOtherSessions(who);
  revalidatePath(PAGE);
  redirect(PAGE);
}
