"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { getFamilyLook } from "@/lib/household-settings";
import { DEFAULT_LOOK, lookColorOf, lookOf } from "@/lib/looks";

const viewMode = z.enum(["BIG", "FULL"]);
const bunsonVolume = z.enum(["CHATTY", "CHEERS", "OFF"]);

/**
 * Phase 19.5 personal preferences, saved for the *active profile* only — anyone, kid or
 * grown-up, may flip their own view or turn Bunson down. Neither is a permission: the view
 * only changes layout, and every page still authorizes itself.
 */
export async function setMyViewMode(mode: string) {
  const profile = await requireActiveProfile();
  const parsed = viewMode.parse(mode);
  await prisma.person.update({ where: { id: profile.id }, data: { viewMode: parsed } });
  revalidatePath("/", "layout");
}

/** Phase 58: save the look and color being tried on. Anyone may pick any look. */
export async function setMyLook(form: FormData) {
  const profile = await requireActiveProfile();
  const look = lookOf(String(form.get("look") ?? ""));
  const color = lookColorOf(look, String(form.get("color") ?? ""));
  const { themeColor } = await getFamilyLook(profile.householdId);
  await prisma.person.update({
    where: { id: profile.id },
    data: {
      look: look.id === DEFAULT_LOOK ? null : look.id,
      // Sticker Book in the family's own color keeps following the family's color.
      lookColor: look.id === DEFAULT_LOOK && color.id === themeColor ? null : color.id,
      lookPromptSeenAt: new Date(),
    },
  });
  revalidatePath("/", "layout");
}

/** Phase 58: the welcome was closed without choosing; it doesn't come back. */
export async function dismissLookPrompt() {
  const profile = await requireActiveProfile();
  await prisma.person.updateMany({ where: { id: profile.id, lookPromptSeenAt: null }, data: { lookPromptSeenAt: new Date() } });
}

export async function setMyBunsonVolume(volume: string) {
  const profile = await requireActiveProfile();
  const parsed = bunsonVolume.parse(volume);
  await prisma.person.update({ where: { id: profile.id }, data: { bunsonVolume: parsed } });
  revalidatePath("/", "layout");
}
