import { prisma } from "@/lib/prisma";

/**
 * Phase 40.1b: how someone gets into the app. `Person.authUserId` means "has their own
 * sign-in", which used to mean Microsoft; with passkeys (and other providers) it doesn't any
 * more. Microsoft is what Graph features (Outlook, mail, photos, the Entra role) need.
 *
 * - "microsoft": their own sign-in, with a Microsoft account linked.
 * - "own": their own sign-in some other way (a passkey).
 * - "pin": no sign-in of their own; a PIN profile under a grown-up's sign-in.
 */
export type SignInKind = "microsoft" | "own" | "pin";

export function signInKindOf(authUserId: string | null, microsoftUserIds: ReadonlySet<string>): SignInKind {
  if (authUserId === null) return "pin";
  return microsoftUserIds.has(authUserId) ? "microsoft" : "own";
}

/** Which of these users have a Microsoft account linked, in one query. */
export async function microsoftLinkedUserIds(userIds: readonly (string | null)[]): Promise<Set<string>> {
  const ids = userIds.filter((id): id is string => id !== null);
  if (ids.length === 0) return new Set();
  const rows = await prisma.account.findMany({ where: { userId: { in: ids }, providerId: "microsoft" }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

/** One person's sign-in kind. */
export async function signInKind(person: { authUserId: string | null }): Promise<SignInKind> {
  return signInKindOf(person.authUserId, await microsoftLinkedUserIds([person.authUserId]));
}
