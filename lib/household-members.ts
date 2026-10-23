import type { PersonRole } from "@/app/generated/prisma/enums";

/**
 * Phase 38: who Settings → Household can remove (the owner's call: people who sign in with
 * Microsoft are managed in Entra, not here). That's anyone without a sign-in of their own
 * (Phase 40.1b: Microsoft or a passkey; removing a passkey user's sign-in is Phase 40.2's), except
 * two kinds who will have one once they sign in: an Admin (only Entra grants that role, or setup
 * does) and a money-jar member (jars are only for adults with their own sign-in). Both happen after a restore,
 * which brings people back without their sign-in link; removing one before their first sign-in
 * would make that sign-in create a second Person, leaving their jars on the first.
 */
export function canRemoveFromHousehold(person: { authUserId: string | null; role: PersonRole | null; jarCount: number }): boolean {
  return person.authUserId === null && person.role !== "ADMIN" && person.jarCount === 0;
}

/**
 * Whether this person's membership and role are out of the People form's hands: anyone with
 * their own sign-in (Entra owns a Microsoft user's; a passkey user's are for Phase 40.2's
 * Settings → Sign-in), and a member `canRemoveFromHousehold` keeps (a restored
 * Admin or jar member). The People form keeps both as they are for them, so it can't take such
 * a person out of the household (or demote a not-yet-linked Admin) behind Settings' back.
 */
export function isMembershipLocked(person: { authUserId: string | null; role: PersonRole | null; isHouseholdMember: boolean; jarCount: number }): boolean {
  return person.authUserId !== null || (person.isHouseholdMember && !canRemoveFromHousehold(person));
}
