"use server";

import { hashPin } from "@/lib/pin-hash";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSessionOwner } from "@/lib/active-profile";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { pinError } from "@/lib/pin-rules";
import { canonicalizeTimeZone, isValidTimeZone } from "@/lib/household-settings";
import { canRemoveFromHousehold } from "@/lib/household-members";

function fail(message: string): never {
  redirect(`/settings/household?error=${encodeURIComponent(message)}`);
}

/**
 * Roster-only: hides someone without a sign-in of their own (a kid, or an adult on a PIN)
 * from the profile picker and blocks them from being (re)selected as the active profile (see
 * the isHouseholdMember checks in lib/active-profile.ts's getActiveProfile and
 * app/profiles/actions.ts's verifyPinAndSelect). Any adult adds them back from their People page.
 *
 * Phase 38 (the owner's call): people with their own sign-in, or who will have one once they
 * sign in after a restore, aren't removed here (`canRemoveFromHousehold`): Microsoft sign-ins
 * are managed in Entra, a passkey user's sign-in in Phase 40.2's Settings → Sign-in. The page shows
 * no Remove for them; this refuses too. lib/active-profile.ts's getAuthPerson still turns
 * away a linked person whose row says they're not a member, as defense in depth.
 * See docs/BUILD.md Phase 4.5 and Phase 38.
 */
export async function removeHouseholdMember(personId: string) {
  const admin = await requireAdmin();

  const target = await prisma.person.findFirst({
    where: { id: personId, householdId: admin.householdId, isHouseholdMember: true },
    omit: { photo: true },
    include: { _count: { select: { moneyJars: true } } },
  });
  if (!target) fail("That household member wasn't found.");
  if (target.id === admin.id) fail("You can't remove yourself.");
  if (!canRemoveFromHousehold({ authUserId: target.authUserId, role: target.role, jarCount: target._count.moneyJars })) {
    fail(`${target.firstName} has their own sign-in (or will, after a restore), so they aren't removed here.`);
  }

  await prisma.person.update({
    where: { id: target.id },
    data: { isHouseholdMember: false, role: null },
  });
  redirect("/settings/household");
}

export type HouseholdSettingsFormState = { error?: string; success?: boolean };

const householdSettingsSchema = z.object({
  name: z.string().trim().min(1, "Household name is required"),
  timezone: z
    .string()
    .trim()
    .optional()
    .refine((tz) => !tz || isValidTimeZone(tz), { message: "Not a recognized timezone" }),
});

// Phase 45.1: where home is has its own actions (lib/home-location/actions.ts), from a phone or a ZIP
// code; this form no longer carries coordinates, so saving it leaves them as they are.

/** Layout/pages read this via lib/household-settings.ts's cached getHouseholdSettings. */
export async function updateHouseholdSettings(
  _prevState: HouseholdSettingsFormState,
  formData: FormData,
): Promise<HouseholdSettingsFormState> {
  const admin = await requireAdmin();

  const parsed = householdSettingsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Canonicalized, not the raw typed string — isValidTimeZone (via the zod refine above)
  // already proved it resolves, so this can't fail; storing the canonical form keeps
  // warnIfTimezoneMismatch's string comparison meaningful regardless of case/alias input.
  const timezone = parsed.data.timezone ? canonicalizeTimeZone(parsed.data.timezone) : null;
  await prisma.household.update({
    where: { id: admin.householdId },
    data: { name: parsed.data.name, timezone },
  });

  revalidatePath("/settings/household");
  return { success: true };
}

export type PinFormState = { error?: string; success?: boolean };


/**
 * Sets (or resets) a household member's profile-picker PIN (Phase 16.5). Before this, only
 * prisma/seed.ts ever hashed a PIN, so a member added in the app, or restored from a
 * backup (which deliberately carries no PIN hashes), could never be selected. Also clears
 * a lockout from too many wrong guesses.
 *
 * Only for people who DON'T sign in with Microsoft, and only by the signed-in admin
 * themselves (Fable's implementation review): a PIN on a linked person would let anyone who
 * knows it switch into that login's profile, e.g. from one admin into another.
 */
export async function setMemberPin(
  personId: string,
  _prevState: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const admin = await requireAdmin();
  if (!(await isSessionOwner(admin))) {
    return { error: "Only an admin signed in with Microsoft (not a switched profile) can set PINs." };
  }

  const pin = String(formData.get("pin") ?? "");
  const target = await prisma.person.findFirst({
    // authUserId: null enforced here, not only by hiding the form (Phase 25's review).
    where: { id: personId, householdId: admin.householdId, isHouseholdMember: true, authUserId: null },
    select: { id: true, role: true },
  });
  if (!target) return { error: "That household member wasn't found, or signs in with Microsoft." };
  // Phase 42: a PIN must never open an admin's profile. The only admin without a sign-in is one a
  // restore brought back who hasn't reconnected yet: they come back by invite (Settings → Sign-in).
  if (target.role === "ADMIN") return { error: "Admins don't get a PIN. Send them an invite to make their own passkey." };
  // Kids 4–6 digits, grown-ups 6 (lib/pin-rules.ts).
  const problem = pinError(target.role, pin);
  if (problem) return { error: problem };

  await prisma.person.update({
    where: { id: target.id },
    data: { pinHash: await hashPin(pin), pinFailedAttempts: 0, pinLockedUntil: null },
  });

  revalidatePath("/settings/household");
  return { success: true };
}
