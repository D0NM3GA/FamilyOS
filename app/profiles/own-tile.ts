import { prisma } from "@/lib/prisma";
import { getActiveProfile } from "@/lib/active-profile";
import { signedInRecently } from "@/lib/session";

/**
 * Whether the signed-in grown-up's own tile asks for their PIN (owner's call, 2026-10-09): on a shared
 * tablet a kid could otherwise tap "Dad (you)" and be in. It doesn't ask when they're already
 * on their own profile, or for the first pick right after a fresh Microsoft sign-in (that was
 * the proof). It does ask when switching back from someone else's profile, or once the sign-in
 * is older. No PIN set, nothing to ask: Settings nudges them to add one.
 *
 * Their PIN only ever locks their own tile on their own sign-in; it never opens their profile
 * from anyone else's (verifyPinAndSelect still refuses every other Microsoft-linked profile).
 */
export async function ownTileLocked(authPersonId: string): Promise<boolean> {
  const hasPin = (await prisma.person.count({ where: { id: authPersonId, pinHash: { not: null } } })) > 0;
  if (!hasPin) return false;
  const current = await getActiveProfile();
  if (current?.id === authPersonId) return false;
  return current != null || !(await signedInRecently());
}
