import { prisma } from "@/lib/prisma";

/**
 * Phase 53: a bank-feed account left out of a jar (the owner's call: its rows stay, but leave the
 * totals). The connection keeps the account's provider id, so the sync stops bringing it in; the
 * account stops counting as spending money; the rows it already brought become IGNORED, which every
 * total leaves out (they only count ACTIVE rows), while Activity still lists them, marked. Bringing
 * it back undoes all three; the next sync fills in what came meanwhile.
 */
export async function setAccountLeftOut(jarId: string, accountId: string, leftOut: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.finAccount.findFirst({ where: { id: accountId, jarId, source: "SIMPLEFIN" }, select: { id: true, externalId: true } });
    const connection = await tx.jarConnection.findUnique({ where: { jarId_provider: { jarId, provider: "SIMPLEFIN" } }, select: { id: true, excludedExternalIds: true } });
    if (!account || !connection) return false;
    const others = connection.excludedExternalIds.filter((id) => id !== account.externalId);
    await tx.jarConnection.update({ where: { id: connection.id }, data: { excludedExternalIds: leftOut ? [...others, account.externalId] : others } });
    if (leftOut) {
      await tx.finAccount.update({ where: { id: account.id }, data: { spending: false } });
      await tx.finTransaction.updateMany({ where: { accountId: account.id, state: "ACTIVE" }, data: { state: "IGNORED" } });
    } else {
      await tx.finTransaction.updateMany({ where: { accountId: account.id, state: "IGNORED" }, data: { state: "ACTIVE" } });
    }
    return true;
  });
}

/** This jar's left-out accounts (their row ids), for the pages that list balances. */
export async function leftOutAccountIds(jarId: string): Promise<Set<string>> {
  const connection = await prisma.jarConnection.findUnique({ where: { jarId_provider: { jarId, provider: "SIMPLEFIN" } }, select: { excludedExternalIds: true } });
  if (!connection?.excludedExternalIds.length) return new Set();
  const accounts = await prisma.finAccount.findMany({ where: { jarId, source: "SIMPLEFIN", externalId: { in: connection.excludedExternalIds } }, select: { id: true } });
  return new Set(accounts.map((a) => a.id));
}
