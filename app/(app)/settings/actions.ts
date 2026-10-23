"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdult } from "@/lib/authz";
import { isOwnSignIn } from "@/lib/active-profile";
import { signedInRecently } from "@/lib/session";
import { pinError } from "@/lib/pin-rules";
import { hashPin } from "@/lib/pin-hash";

const input = z.object({ personId: z.string().min(1), mode: z.enum(["BIG", "FULL"]) });

/**
 * Phase 19.5: a grown-up sets a household member's starting view. Any adult, not just
 * admins (owner's call: "grown-ups set the start"); the person can still flip it themselves
 * afterwards. updateMany scoped to this household's members, so an id from anywhere else
 * is a silent no-op rather than a cross-household write.
 */
export async function setMemberViewMode(personId: string, mode: string) {
  const profile = await requireAdult();
  const parsed = input.parse({ personId, mode });
  await prisma.person.updateMany({
    where: { id: parsed.personId, householdId: profile.householdId, isHouseholdMember: true },
    data: { viewMode: parsed.mode },
  });
  revalidatePath("/", "layout");
}

export type MyPinState = { error?: string; saved?: number };

/**
 * Locks your own tile on the profile picker with a PIN (app/profiles/own-tile.ts), or changes
 * it. Only on your own sign-in. and only a fresh one: an unlocked tablet left on your
 * profile mustn't let someone else set or change it. Grown-ups' PINs are 6 digits.
 */
export async function setMyPin(_prev: MyPinState, formData: FormData): Promise<MyPinState> {
  const profile = await requireAdult();
  if (!profile.authUserId || !(await isOwnSignIn(profile))) return { error: "Only on your own sign-in." };
  if (!(await signedInRecently())) return { error: "Sign in again first (it keeps someone else from changing your PIN)." };
  const pin = String(formData.get("pin") ?? "");
  const problem = pinError(profile.role, pin);
  if (problem) return { error: problem };
  if (pin !== String(formData.get("again") ?? "")) return { error: "The two PINs don't match." };
  await prisma.person.update({
    where: { id: profile.id },
    data: { pinHash: await hashPin(pin), pinFailedAttempts: 0, pinLockedUntil: null },
  });
  revalidatePath("/settings", "layout");
  return { saved: Date.now() };
}

/** Takes the lock off your own tile. Same rules as setting it. */
export async function clearMyPin(): Promise<MyPinState> {
  const profile = await requireAdult();
  if (!profile.authUserId || !(await isOwnSignIn(profile))) return { error: "Only on your own sign-in." };
  if (!(await signedInRecently())) return { error: "Sign in again first." };
  await prisma.person.update({ where: { id: profile.id }, data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null } });
  revalidatePath("/settings", "layout");
  return { saved: Date.now() };
}
