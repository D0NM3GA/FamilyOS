import { prisma } from "@/lib/prisma";

/**
 * Phase 53: a bank-feed account left out of a jar (the owner's call: its rows stay, but leave the
 * totals). The account is marked (`FinAccount.leftOut`, kept in backups), so the sync stops
 * bringing it in; it stops counting as spending money; the rows it already brought become
 * IGNORED, which every total leaves out (they only count ACTIVE rows), while Activity still lists
 * them, marked. Bringing it back turns the rows back; spending stays off until someone ticks it
 * again (the page says so). The next sync fills in what came meanwhile.
 */
export async function setAccountLeftOut(jarId: string, accountId: string, leftOut: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.finAccount.findFirst({ where: { id: accountId, jarId, source: "SIMPLEFIN" }, select: { id: true } });
    if (!account) return false;
    await tx.finAccount.update({ where: { id: account.id }, data: leftOut ? { leftOut: true, spending: false } : { leftOut: false } });
    await tx.finTransaction.updateMany({
      where: { accountId: account.id, state: leftOut ? "ACTIVE" : "IGNORED" },
      data: { state: leftOut ? "IGNORED" : "ACTIVE" },
    });
    return true;
  });
}

/** This jar's left-out accounts (their row ids), for the pages that list balances. */
export async function leftOutAccountIds(jarId: string): Promise<Set<string>> {
  const accounts = await prisma.finAccount.findMany({ where: { jarId, leftOut: true }, select: { id: true } });
  return new Set(accounts.map((a) => a.id));
}
