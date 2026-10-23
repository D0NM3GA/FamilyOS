"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { setOthersSignInNotices } from "@/lib/sign-in-notices";

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
