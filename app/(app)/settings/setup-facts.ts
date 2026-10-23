import { backupSignInState, type requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { pendingInvites } from "@/lib/invites";
import { getVapidState } from "@/lib/alerts/vapid";
import { setupChecklist, type SetupItem } from "@/lib/setup-checklist";

type Profile = Awaited<ReturnType<typeof requireActiveProfile>>;

/**
 * Phase 45.4: the "Finish setting up" checklist for this person, from what the app already
 * keeps (lib/setup-checklist.ts decides what each fact means). One parallel batch.
 */
export async function loadSetupChecklist(profile: Profile): Promise<SetupItem[]> {
  const adult = isAdult(profile);
  if (!adult) return [];
  const admin = isAdmin(profile);
  const [household, kids, grownUps, invites, keys, phones, signIn, hasPin, passkeys] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: profile.householdId }, select: { latitude: true, longitude: true, setupReviewed: true } }),
    admin ? prisma.person.count({ where: { householdId: profile.householdId, isHouseholdMember: true, role: "KID" } }) : 0,
    admin
      ? prisma.person.count({
          where: { householdId: profile.householdId, isHouseholdMember: true, role: { in: ["ADMIN", "ADULT"] }, authUserId: { not: null }, id: { not: profile.id } },
        })
      : 0,
    admin ? pendingInvites(profile.householdId).then((all) => all.filter((i) => !i.recovery && i.usable).length) : 0,
    getVapidState(),
    prisma.pushSubscription.count({ where: { personId: profile.id } }),
    profile.authUserId ? backupSignInState(profile) : null,
    prisma.person.count({ where: { id: profile.id, pinHash: { not: null } } }).then((n) => n > 0),
    profile.authUserId ? prisma.passkey.count({ where: { userId: profile.authUserId } }) : 0,
  ]);
  return setupChecklist({
    admin,
    adult,
    homeSet: household.latitude != null && household.longitude != null,
    reviewed: household.setupReviewed,
    kids,
    otherGrownUps: grownUps + invites,
    pushReady: keys.ok,
    phones,
    ownSignIn: Boolean(signIn?.own),
    passkeySignIn: Boolean(signIn?.passkey),
    hasPin,
    passkeys,
  });
}
