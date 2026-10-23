"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { signedInRecently, signedInWithin } from "@/lib/session";
import { NEW_WAY_IN_SECONDS } from "@/lib/fresh-sign-in";
import { createInvite, InviteError, inviteLink, inviteSchema, revokeInvite } from "@/lib/invites";
import { changeRole, removeSignIn, resetPasskeys, SignInAdminError, SIGN_IN_ERRORS, type Announced } from "@/lib/sign-ins";
import { deliverSignInNotices } from "@/lib/sign-in-notices";
import { microsoftEnabled } from "@/lib/auth";
import { announceEntraCheck, entraCheckNowAllowed, runEntraCheck } from "@/lib/entra-check";

const PAGE = "/settings/sign-in";

/** An admin on their own profile (not a PIN-switch onto someone else's), or null. */
async function signedInAdmin() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile) || !(await isSessionOwner(profile))) return null;
  return profile;
}

/**
 * Phase 40.2c: changing who can get in (an invite, a role, a reset, a removal) wants a sign-in
 * from the last 5 minutes, like adding a passkey: the code of what's missing, or the admin.
 */
type Admin = NonNullable<Awaited<ReturnType<typeof signedInAdmin>>>;

async function managingAdmin(): Promise<{ admin: Admin } | { admin: null; error: "notAdmin" | "stale" }> {
  const admin = await signedInAdmin();
  if (!admin) return { admin: null, error: "notAdmin" };
  if (!(await signedInWithin(NEW_WAY_IN_SECONDS))) return { admin: null, error: "stale" };
  return { admin };
}

/** Delivers a change's notices once the response is on its way (they're already in the bell). */
function announce(notices: Announced) {
  if (notices.subjectNotices.length || notices.otherNotices.length) after(() => deliverSignInNotices(notices));
}

// A server action's arguments come from the client, whatever the types say.
const isId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 64;

export type InviteFormState = { error?: string; link?: string; firstName?: string };

/** Makes an invite and hands back its link, once (the server keeps only a hash of it). */
export async function createInviteAction(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const who = await managingAdmin();
  if (!who.admin) return { error: SIGN_IN_ERRORS[who.error] };
  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = inviteSchema.safeParse({
    who: field("who"),
    personId: field("personId"),
    firstName: field("firstName"),
    lastName: field("lastName"),
    email: field("email"),
    role: field("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the invite's details." };
  try {
    const token = await createInvite(who.admin, parsed.data);
    revalidatePath(PAGE);
    return { link: inviteLink(token), firstName: parsed.data.who === "new" ? parsed.data.firstName : undefined };
  } catch (e) {
    if (e instanceof InviteError) return { error: e.message };
    throw e;
  }
}

/** Cancels a waiting invite: its link stops working. */
export async function revokeInviteAction(inviteId: string) {
  if (!isId(inviteId)) redirect(`${PAGE}?error=inviteGone`);
  const admin = await signedInAdmin();
  if (!admin) redirect(`${PAGE}?error=notAdmin`);
  try {
    await revokeInvite(admin, inviteId);
  } catch (e) {
    if (e instanceof InviteError) redirect(`${PAGE}?error=inviteGone`);
    throw e;
  }
  redirect(PAGE);
}

/** Adult ↔ Admin for someone who signs in with a passkey. */
export async function changeRoleAction(personId: string, role: string) {
  if (!isId(personId) || (role !== "ADULT" && role !== "ADMIN")) redirect(`${PAGE}?error=gone`);
  const who = await managingAdmin();
  if (!who.admin) redirect(`${PAGE}?error=${who.error}`);
  try {
    announce(await changeRole(who.admin, personId, role));
  } catch (e) {
    if (e instanceof SignInAdminError) redirect(`${PAGE}?error=${e.code}`);
    throw e;
  }
  redirect(PAGE);
}

export type ResetState = { error?: string; link?: string };

/** Lost phone: clears their passkeys and hands back a 1-hour link, once, for the admin to give them. */
export async function resetPasskeysAction(personId: string): Promise<ResetState> {
  if (!isId(personId)) return { error: SIGN_IN_ERRORS.gone };
  const who = await managingAdmin();
  if (!who.admin) return { error: SIGN_IN_ERRORS[who.error] };
  try {
    const { token, ...notices } = await resetPasskeys(who.admin, personId);
    announce(notices);
    revalidatePath(PAGE);
    return { link: inviteLink(token) };
  } catch (e) {
    if (e instanceof SignInAdminError) return { error: e.message };
    throw e;
  }
}

/** Takes someone's own sign-in away; they're a PIN profile again. */
export async function removeSignInAction(personId: string) {
  if (!isId(personId)) redirect(`${PAGE}?error=gone`);
  const who = await managingAdmin();
  if (!who.admin) redirect(`${PAGE}?error=${who.error}`);
  try {
    announce(await removeSignIn(who.admin, personId));
  } catch (e) {
    if (e instanceof SignInAdminError) redirect(`${PAGE}?error=${e.code}`);
    throw e;
  }
  redirect(PAGE);
}

/**
 * Phase 40.4: "Check now": the Entra check, here and now, instead of waiting for the tick. It
 * can end someone's access, so it asks for a sign-in from the last 15 minutes (like a backup),
 * and not again within a minute of the last run.
 */
export async function checkEntraNow() {
  const admin = await signedInAdmin();
  if (!admin) redirect(`${PAGE}?error=notAdmin`);
  if (!microsoftEnabled()) redirect(PAGE);
  if (!(await signedInRecently())) redirect(`${PAGE}?error=stale`);
  if (!(await entraCheckNowAllowed(admin.householdId))) redirect(`${PAGE}?error=entraWait`);
  const result = await runEntraCheck(admin.householdId);
  if (result.notices.length) after(() => announceEntraCheck(result));
  redirect(result.outcome === "busy" ? `${PAGE}?error=entraWait` : PAGE);
}
