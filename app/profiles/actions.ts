"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthPerson, setActiveProfileCookie } from "@/lib/active-profile";
import { getServerSession, signedInRecently } from "@/lib/session";
import { isDevUser } from "@/lib/dev-auth";
import { lockLabel, lockoutMs } from "@/lib/pin-lockout";
import { verifyPin } from "@/lib/pin-hash";
import { ownTileLocked } from "./own-tile";

export type PinState = { error?: string };

const MAX_PIN_ATTEMPTS = 5;

/**
 * Opening your own profile on your own sign-in. A fresh sign-in is better proof than the PIN, so
 * it clears a lockout that someone else's wrong guesses left on this tile.
 */
async function openOwnProfile(personId: string) {
  if (await signedInRecently()) {
    await prisma.person.updateMany({
      where: { id: personId, OR: [{ pinFailedAttempts: { gt: 0 } }, { pinLockedUntil: { not: null } }] },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }
  await setActiveProfileCookie(personId);
}

/** The signed-in adult selecting their own tile: no PIN, unless their tile is locked (own-tile.ts). */
export async function selectOwnProfile(personId: string) {
  const authPerson = await getAuthPerson();
  if (!authPerson) redirect("/sign-in");
  if (authPerson.id !== personId) redirect("/profiles");
  // The picker shows a PIN pad for a locked tile; this is the check that counts.
  if (await ownTileLocked(authPerson.id)) redirect("/profiles");
  await openOwnProfile(personId);
  redirect("/");
}

/**
 * Phase 40.2a: right after signing in again in place (a passkey, components/sign-in-again.tsx),
 * carries on as yourself instead of a trip through the picker: the new session has no profile
 * yet. The same rule as tapping your own tile; a locked tile still goes through the picker.
 */
export async function continueAsYourself(): Promise<void> {
  const authPerson = await getAuthPerson();
  if (!authPerson || (await ownTileLocked(authPerson.id))) return;
  await openOwnProfile(authPerson.id);
}

/**
 * DEV-ONLY (lib/dev-auth.ts), remove before shipping: the dev test session opens any
 * household member's profile without their PIN, so kid views can be tested.
 */
export async function devSelectProfile(personId: string) {
  const session = await getServerSession();
  if (!isDevUser(session?.user)) redirect("/profiles");
  const authPerson = await getAuthPerson();
  if (!authPerson) redirect("/sign-in");
  const target = await prisma.person.findFirst({
    where: { id: personId, householdId: authPerson.householdId, isHouseholdMember: true, authUserId: null },
    select: { id: true },
  });
  if (!target) redirect("/profiles");
  await setActiveProfileCookie(target.id);
  redirect("/");
}

/** Selecting any other household member's tile (kid or adult) requires their PIN; so does a locked own tile. */
export async function verifyPinAndSelect(
  prevState: PinState,
  formData: FormData,
): Promise<PinState> {
  const authPerson = await getAuthPerson();
  if (!authPerson) redirect("/sign-in");

  const personId = String(formData.get("personId") ?? "");
  const pin = String(formData.get("pin") ?? "");

  // pinHash is omitted by default (lib/prisma.ts) to keep it out of every other query's
  // result — this is the one place that needs it, to verify against.
  const target = await prisma.person.findUnique({
    where: { id: personId },
    omit: { photo: true, pinHash: false },
  });
  if (
    !target ||
    target.householdId !== authPerson.householdId ||
    !target.isHouseholdMember ||
    !target.pinHash ||
    // Phase 25: someone who signs in with Microsoft is only ever reached by their own
    // sign-in, never by a PIN, so a switched profile can't stand in for them (money jars).
    // Their own PIN only unlocks their own tile, on their own sign-in.
    (target.authUserId != null && target.id !== authPerson.id) ||
    // Phase 42: a PIN never opens an admin who has no sign-in (a restored one, not reconnected
    // yet), even one set before setMemberPin refused it.
    (target.role === "ADMIN" && target.authUserId == null)
  ) {
    return { error: "That profile isn't available." };
  }

  // One guess at a time per profile: the lock check, the PIN check and the count are one step
  // under an advisory lock, so a burst of parallel guesses can't all slip past the lock.
  const result = await prisma.$transaction(async (tx): Promise<PinState | null> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${target.id}))`;
    // The hash is read again under the lock, so a PIN changed meanwhile is the one checked
    // (and a rehash below can't put back an old one).
    const now = await tx.person.findUniqueOrThrow({
      where: { id: target.id },
      select: { pinFailedAttempts: true, pinLockedUntil: true, pinHash: true },
    });
    if (!now.pinHash) return { error: "That profile isn't available." };
    if (now.pinLockedUntil && now.pinLockedUntil > new Date()) {
      return { error: `Too many incorrect attempts — try again in ${lockLabel(now.pinLockedUntil.getTime() - Date.now())}.` };
    }

    const check = await verifyPin(now.pinHash, pin);
    if (!check.ok) {
      const failed = now.pinFailedAttempts + 1;
      // The count keeps going (only a right PIN resets it), so each lock is twice as long as
      // the last: 15 min, 30, 1 h ... up to a day. A flat 15 minutes let a 4-digit PIN be
      // guessed in a few weeks.
      const lockMs = failed % MAX_PIN_ATTEMPTS === 0 ? lockoutMs(failed / MAX_PIN_ATTEMPTS) : 0;
      await tx.person.update({
        where: { id: target.id },
        data: { pinFailedAttempts: failed, ...(lockMs ? { pinLockedUntil: new Date(Date.now() + lockMs) } : {}) },
      });
      return { error: lockMs ? `Too many incorrect attempts — try again in ${lockLabel(lockMs)}.` : "Incorrect PIN." };
    }

    if (now.pinFailedAttempts > 0 || now.pinLockedUntil || check.rehashed) {
      await tx.person.update({
        where: { id: target.id },
        data: { pinFailedAttempts: 0, pinLockedUntil: null, ...(check.rehashed ? { pinHash: check.rehashed } : {}) },
      });
    }
    return null;
  });
  if (result) return result;

  await setActiveProfileCookie(target.id);
  redirect("/");
}
