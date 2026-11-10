import { prisma } from "@/lib/prisma";
import { getActiveProfile } from "@/lib/active-profile";
import { signedInRecently } from "@/lib/session";

/**
 * What the signed-in grown-up's own tile asks before it opens: nothing, their PIN, or a fresh
 * sign-in. On a shared tablet a kid could otherwise tap "Dad (you)" and be in (owner's call,
 * 2026-10-09). With a PIN: it doesn't ask when they're already on their own profile, or for the
 * first pick right after a fresh sign-in (that was the proof); it does when switching back from
 * someone else's profile, or once the sign-in is older.
 *
 * Without a PIN there's nothing to type, so switching back from someone else's profile asks
 * for a fresh sign-in instead (the security review, 2026-11-10): otherwise it was the one way
 * from a kid's profile into a grown-up's without proving anything. Settings nudges them to
 * add a PIN, which makes this a few digits rather than a sign-in.
 *
 * Their PIN only ever locks their own tile on their own sign-in; it never opens their profile
 * from anyone else's (verifyPinAndSelect still refuses every other Microsoft-linked profile).
 */
export type OwnTileAsks = "nothing" | "pin" | "signIn";

export async function ownTileAsks(authPersonId: string): Promise<OwnTileAsks> {
  const current = await getActiveProfile();
  if (current?.id === authPersonId) return "nothing";
  const hasPin = (await prisma.person.count({ where: { id: authPersonId, pinHash: { not: null } } })) > 0;
  if (hasPin) return current != null || !(await signedInRecently()) ? "pin" : "nothing";
  return current != null && !(await signedInRecently()) ? "signIn" : "nothing";
}

/** Whether tapping the tile can't just open it (selectOwnProfile's check). */
export async function ownTileLocked(authPersonId: string): Promise<boolean> {
  return (await ownTileAsks(authPersonId)) !== "nothing";
}
