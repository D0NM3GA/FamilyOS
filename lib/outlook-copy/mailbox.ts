import { prisma } from "@/lib/prisma";
import { isMailboxAddress } from "@/lib/alerts/email";

/**
 * Phase 70a: which mailbox the app reads for someone. A grown-up's Microsoft sign-in carries their
 * Entra object id (Better Auth keeps it as the account id), which Graph takes in /users/{id} and
 * never changes; anyone else (kids don't sign in with Microsoft here) uses the email on their
 * People page.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MailboxSource = { mailbox: string; from: "microsoft" | "email" };

/** Pure: picks the mailbox from what's known about a person. */
export function pickMailbox(microsoftAccountId: string | null | undefined, email: string | null | undefined): MailboxSource | null {
  if (microsoftAccountId && GUID.test(microsoftAccountId)) return { mailbox: microsoftAccountId.toLowerCase(), from: "microsoft" };
  const e = email?.trim().toLowerCase();
  if (e && isMailboxAddress(e)) return { mailbox: e, from: "email" };
  return null;
}

/** Each household member's mailbox (or null), for Settings and for saving a choice. */
export async function householdMailboxes(householdId: string): Promise<Map<string, MailboxSource | null>> {
  const people = await prisma.person.findMany({
    where: { householdId, isHouseholdMember: true, entraAccessEndedAt: null },
    select: { id: true, email: true, authUser: { select: { accounts: { where: { providerId: "microsoft" }, orderBy: { updatedAt: "desc" }, select: { accountId: true }, take: 1 } } } },
  });
  return new Map(people.map((p) => [p.id, pickMailbox(p.authUser?.accounts[0]?.accountId, p.email)]));
}
