import { prisma } from "@/lib/prisma";
import { hasCalendarWriteScope } from "./plan";

/**
 * Whether the signed-in Microsoft account has granted calendar write access, from the
 * scopes Microsoft returned at sign-in (better-auth stores them on the account row).
 * Microsoft treats access tokens as opaque to clients, so this never decodes one; a 403
 * from Graph is the backstop.
 */
export async function calendarWriteGranted(authUserId: string): Promise<boolean> {
  const account = await prisma.account.findFirst({ where: { userId: authUserId, providerId: "microsoft" }, select: { scope: true } });
  return hasCalendarWriteScope(account?.scope);
}
