import { prisma } from "@/lib/prisma";

/**
 * Phase 21.5: whose alerts an admin may switch. Any ADMIN who is a current member of the
 * same household — the people who receive Sticker Store alerts. Kids, other adults,
 * removed members and other households resolve to null. One function so the DB test pins
 * the rule instead of each action re-deriving it.
 */
export function findAlertTarget(householdId: string, personId: string) {
  return prisma.person.findFirst({
    // Phase 40.4: not someone Entra cut off (they're no admin while ended).
    where: { id: personId, householdId, isHouseholdMember: true, role: "ADMIN", entraAccessEndedAt: null },
    select: { id: true, firstName: true, email: true, authUser: { select: { email: true, accounts: { where: { providerId: "microsoft" }, select: { id: true } } } } },
  });
}

/** Everyone who receives store alerts in this household. */
export function listAlertTargets(householdId: string) {
  return prisma.person.findMany({
    where: { householdId, isHouseholdMember: true, role: "ADMIN", entraAccessEndedAt: null },
    orderBy: { firstName: "asc" },
    select: {
      id: true,
      firstName: true,
      email: true,
      authUser: { select: { email: true, accounts: { where: { providerId: "microsoft" }, select: { id: true } } } },
      alertPrefs: {
        select: {
          teamsEnabled: true,
          emailEnabled: true,
          lastErrorTeams: true,
          lastErrorEmail: true,
          lastSentTeams: true,
          lastSentEmail: true,
          lastErrorPush: true,
          lastSentPush: true,
        },
      },
      // Phase 21.6: device ids and dates only — never the endpoint or keys.
      pushSubscriptions: { select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
}
