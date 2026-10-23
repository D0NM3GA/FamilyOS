import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isOwnSignIn, requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";

/**
 * Phase 25: the one gate for money. A jar opens only for an adult who is one of its members
 * AND is using the app as themselves: their own sign-in (Microsoft or, from Phase 40, a
 * passkey), not a profile switched
 * to on someone else's (lib/active-profile.ts isOwnSignIn). Being an admin grants nothing
 * here. Anything else is "not found", so a jar's existence isn't revealed either.
 *
 * The honest boundary: this stops access inside the app. Whoever runs the server, the
 * database or the Microsoft tenant can still read the data.
 */

export type MoneyViewer = { id: string; householdId: string; firstName: string };

/** Who may use Finances at all right now, or null (kid, switched profile, ...). */
export async function moneyViewer(): Promise<MoneyViewer | null> {
  const profile = await requireActiveProfile();
  if (!isAdult(profile) || !profile.isHouseholdMember) return null;
  if (!(await isOwnSignIn(profile))) return null;
  return { id: profile.id, householdId: profile.householdId, firstName: profile.firstName };
}

/** The jar, for one of its members, or notFound(). Every finance read/write goes through this. */
export async function requireJar(jarId: string) {
  const viewer = await moneyViewer();
  if (!viewer || typeof jarId !== "string" || jarId.length > 64) notFound();
  const jar = await prisma.moneyJar.findFirst({
    where: { id: jarId, householdId: viewer.householdId, members: { some: { personId: viewer.id } } },
    select: { id: true, name: true, emoji: true, householdId: true },
  });
  if (!jar) notFound();
  return { viewer, jar };
}

/** Household adults with their own sign-in (any kind, Phase 40): the only people a jar can have. */
export function eligibleMemberWhere(householdId: string) {
  return { householdId, isHouseholdMember: true, role: { in: ["ADULT" as const, "ADMIN" as const] }, authUserId: { not: null } };
}
