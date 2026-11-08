import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dedupeAccount } from "./sync";

type Tx = Prisma.TransactionClient;

export type MergeResult = { ok: true; moved: number; from: string; into: string } | { ok: false; error: string };

/**
 * Phase 70e: a statement account (made by importing a file into "a new account") merged into the
 * bank-feed account it really is, so the weeks both cover stop counting twice. One transaction:
 * its rows, imports and open questions move across, its import layouts join the feed account's,
 * its balance days go (the feed has its own), and the usual duplicate check folds the overlap.
 * Only a statement account into a feed account of the same jar, neither left out.
 */
export async function mergeStatementAccount(jarId: string, sourceId: string, targetId: string): Promise<MergeResult> {
  if (sourceId === targetId) return { ok: false, error: "Pick a different account to merge into." };
  return prisma.$transaction(
    async (tx) => {
      const [source, target] = await Promise.all([
        tx.finAccount.findFirst({ where: { id: sourceId, jarId }, select: { id: true, name: true, source: true, leftOut: true, currency: true, importLayouts: true } }),
        tx.finAccount.findFirst({ where: { id: targetId, jarId }, select: { id: true, name: true, source: true, leftOut: true, currency: true, importLayouts: true } }),
      ]);
      if (!source || !target) return { ok: false, error: "That account isn't in this jar anymore." };
      if (source.source !== "MANUAL") return { ok: false, error: "Only an account made from a statement can be merged." };
      if (target.source !== "SIMPLEFIN") return { ok: false, error: "Merge it into an account from the bank feed." };
      if (source.leftOut || target.leftOut) return { ok: false, error: "Bring a left-out account back before merging it." };
      if (source.currency !== target.currency) return { ok: false, error: "Those accounts are in different currencies." };

      const moved = await moveRows(tx, source.id, target.id);
      await tx.finImport.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      await tx.reconcileIssue.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      const layouts = { ...asObject(source.importLayouts), ...asObject(target.importLayouts) };
      await tx.finAccount.update({ where: { id: target.id }, data: { importLayouts: layouts as Prisma.InputJsonValue } });
      await tx.finBalanceDay.deleteMany({ where: { accountId: source.id } });
      await tx.finAccount.delete({ where: { id: source.id } });
      await dedupeAccount(tx, jarId, target.id);
      return { ok: true, moved, from: source.name, into: target.name };
    },
    { timeout: 60_000 },
  );
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Moves every row across. A statement row the feed account already holds under the same id (the
 * same file imported into both) becomes that row's duplicate, renamed so the move doesn't collide.
 */
async function moveRows(tx: Tx, sourceId: string, targetId: string): Promise<number> {
  const rows = await tx.finTransaction.findMany({ where: { accountId: sourceId }, select: { id: true, source: true, externalId: true } });
  if (rows.length === 0) return 0;
  const clashes = await tx.finTransaction.findMany({
    where: { accountId: targetId, OR: rows.map((r) => ({ source: r.source, externalId: r.externalId })) },
    select: { id: true, source: true, externalId: true },
  });
  const clashOf = new Map(clashes.map((c) => [`${c.source}|${c.externalId}`, c.id]));
  for (const r of rows) {
    const existing = clashOf.get(`${r.source}|${r.externalId}`);
    if (!existing) continue;
    await tx.finTransaction.update({
      where: { id: r.id },
      data: { externalId: `${r.externalId}:merged:${r.id}`, state: "DUPLICATE", duplicateOfId: existing },
    });
  }
  const { count } = await tx.finTransaction.updateMany({ where: { accountId: sourceId }, data: { accountId: targetId } });
  return count;
}
