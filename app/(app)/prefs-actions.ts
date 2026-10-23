"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";

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

export async function setMyBunsonVolume(volume: string) {
  const profile = await requireActiveProfile();
  const parsed = bunsonVolume.parse(volume);
  await prisma.person.update({ where: { id: profile.id }, data: { bunsonVolume: parsed } });
  revalidatePath("/", "layout");
}
