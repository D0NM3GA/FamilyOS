import { prisma, type Tx } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { decryptSecret, encryptSecret, fingerprint } from "@/lib/crypto";
import { householdWithAppOn } from "@/lib/app-switches";
import type { FinProvider } from "@/app/generated/prisma/enums";
import { fetchAccounts, SimpleFinError, type SfAccount } from "./simplefin";
import { fetchCharges, PrivacyError } from "./privacy";
import type { ImportedRow } from "./importers";
import { dupKey, findDuplicates, matchPrivacy, supersededPending } from "./reconcile";
import { merchantKeyOf } from "./categories";
import { organizeJar } from "./organize";
import { todayCivil } from "./budget";
import { civilDate } from "./gifts";

/**
 * Phase 25: getting money data in and through the reconciler (lib/finance/reconcile.ts).
 * Callers have already passed lib/finance/access.ts requireJar; everything here is scoped
 * by jar id. Nothing here logs or throws a description, payee, memo or amount.
 *
 * Rate: SimpleFIN allows about 24 requests a day. A connection syncs at most once an hour
 * (a lease and the last-sync time enforce it), so 24 a day is the ceiling by construction;
 * pages sync on visit only when the last sync is over 6 hours old.
 */

const HOUR = 3_600_000;
const ON_VISIT_AFTER = 6 * HOUR;
const MIN_GAP = HOUR;
const LEASE_MS = 2 * 60_000;
const FIRST_WINDOW_DAYS = 89;
const OVERLAP_DAYS = 10;
// Privacy charges can settle well after they're created (and are skipped until they do).
const PRIVACY_OVERLAP_DAYS = 30;
// Unmatched Privacy charges older than this will never find their bank row.
const PRIVACY_MATCH_DAYS = 60;
const DAY = 86_400_000;

export const aad = (jarId: string, provider: FinProvider) => `jar:${jarId}:${provider}`;

export async function saveConnection(jarId: string, provider: FinProvider, secret: string, createdById: string) {
  const enc = encryptSecret(secret, aad(jarId, provider));
  // A reconnect keeps any sync lease in place, so a sync already running isn't doubled.
  const data = {
    encryptedValue: new Uint8Array(enc.encryptedValue),
    iv: new Uint8Array(enc.iv),
    authTag: new Uint8Array(enc.authTag),
    lastError: null,
    providerMessage: null,
    lastSyncAt: null,
    retryAfterUntil: null,
    createdById,
    // Phase 30: lets a second jar spot the same Privacy.com account (actions.ts connectPrivacy).
    fingerprint: provider === "PRIVACY" ? fingerprint("privacy", secret) : null,
    skippedAccounts: 0,
    skippedJarId: null,
  };
  return prisma.jarConnection.upsert({
    where: { jarId_provider: { jarId, provider } },
    create: { jarId, provider, ...data },
    update: data,
    select: { id: true },
  });
}

/** Claims connections due for a sync (lease), returning their ids. `force` = "Sync now". */
export async function claimConnections(jarId: string, opts: { force: boolean; now?: Date }): Promise<string[]> {
  const now = opts.now ?? new Date();
  const due = new Date(now.getTime() - (opts.force ? MIN_GAP : ON_VISIT_AFTER));
  const candidates = await prisma.jarConnection.findMany({
    where: {
      jarId,
      // Phase 36: no bank syncs, on a visit or in the background, while Money is turned off.
      jar: { household: householdWithAppOn("money") },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: due } }],
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { OR: [{ retryAfterUntil: null }, { retryAfterUntil: { lt: now } }] },
      ],
    },
    select: { id: true },
  });
  const claimed: string[] = [];
  for (const c of candidates) {
    const { count } = await prisma.jarConnection.updateMany({
      where: { id: c.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (count === 1) claimed.push(c.id);
  }
  return claimed;
}

/** From the last SUCCESSFUL sync (minus an overlap), never further back than the feed allows. */
function windowStart(lastSuccessAt: Date | null, now: Date, overlapDays: number): Date {
  const earliest = now.getTime() - FIRST_WINDOW_DAYS * DAY;
  return new Date(lastSuccessAt ? Math.max(earliest, lastSuccessAt.getTime() - overlapDays * DAY) : earliest);
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (civil: string) => new Date(`${civil}T00:00:00Z`);

/** Runs one claimed connection. Errors are recorded on the connection, never thrown. */
export async function syncConnection(connectionId: string, deps: { fetchFn?: typeof fetch; now?: Date } = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const conn = await prisma.jarConnection.findUnique({ where: { id: connectionId } });
  if (!conn) return;
  let secret: string;
  try {
    secret = decryptSecret({ encryptedValue: Buffer.from(conn.encryptedValue), iv: Buffer.from(conn.iv), authTag: Buffer.from(conn.authTag) }, aad(conn.jarId, conn.provider));
  } catch {
    await finish(conn.id, conn.jarId, now, { error: "The saved connection couldn't be read. Reconnect it." });
    return;
  }
  const start = windowStart(conn.lastSuccessAt, now, conn.provider === "PRIVACY" ? PRIVACY_OVERLAP_DAYS : OVERLAP_DAYS);
  try {
    if (conn.provider === "SIMPLEFIN") {
      const { accounts, messages } = await fetchAccounts(secret, { start, end: new Date(now.getTime() + DAY) }, deps.fetchFn);
      const kept = await guardAccounts(conn.id, conn.jarId, conn.createdById, accounts);
      await applySimpleFin(conn.jarId, kept, day(start), todayCivil(now));
      await organizeSafely(conn.jarId, now);
      await finish(conn.id, conn.jarId, now, { message: messages.join(" · ").slice(0, 200) || null });
    } else {
      const charges = await fetchCharges(secret, start, deps.fetchFn);
      // Each row is idempotent by token, so no long transaction: new ones in bulk, then only
      // the ones whose amount or status changed.
      const known = await prisma.privacyCharge.findMany({
        where: { jarId: conn.jarId, token: { in: charges.map((c) => c.token) } },
        select: { token: true, amountCents: true, status: true },
      });
      const byToken = new Map(known.map((k) => [k.token, k]));
      await prisma.privacyCharge.createMany({ data: charges.filter((c) => !byToken.has(c.token)).map((c) => ({ jarId: conn.jarId, ...c })), skipDuplicates: true });
      for (const c of charges) {
        const k = byToken.get(c.token);
        if (k && (k.amountCents !== c.amountCents || k.status !== c.status)) {
          await prisma.privacyCharge.updateMany({ where: { jarId: conn.jarId, token: c.token }, data: { amountCents: c.amountCents, status: c.status } });
        }
      }
      await enrichPrivacy(prisma, conn.jarId, now);
      await organizeSafely(conn.jarId, now);
      await finish(conn.id, conn.jarId, now, {});
    }
  } catch (err) {
    const known = err instanceof SimpleFinError || err instanceof PrivacyError;
    // The error's type only: its message could carry a description or an amount.
    if (!known) captureError(new Error(`money jar sync failed (connection ${conn.id}): ${err instanceof Error ? err.constructor.name : "unknown"}`));
    const retry = err instanceof SimpleFinError && err.kind === "busy" ? new Date(now.getTime() + (err.retryAfterMs ?? HOUR)) : null;
    await finish(conn.id, conn.jarId, now, { error: known ? err.message : "Sync failed. It'll try again later.", retryAfterUntil: retry });
  }
}

async function finish(
  id: string,
  jarId: string,
  now: Date,
  outcome: { error?: string; message?: string | null; retryAfterUntil?: Date | null },
) {
  await prisma.jarConnection.update({
    where: { id },
    data: {
      leaseUntil: null,
      lastSyncAt: now,
      ...(outcome.error ? {} : { lastSuccessAt: now }),
      lastError: outcome.error ?? null,
      retryAfterUntil: outcome.retryAfterUntil ?? null,
      ...(outcome.message !== undefined ? { providerMessage: outcome.message } : {}),
    },
  });
  const key = `sync:${id}`;
  if (outcome.error) {
    await prisma.reconcileIssue.upsert({
      where: { jarId_key: { jarId, key } },
      create: { jarId, key, kind: "SYNC_ERROR" },
      update: { resolvedAt: null, resolution: null },
    });
  } else {
    await prisma.reconcileIssue.updateMany({ where: { jarId, key, resolvedAt: null }, data: { resolvedAt: now, resolution: "DISMISSED" } });
  }
}

/**
 * Phase 30: one bank account, one jar. An account this feed returns that's already in another
 * jar of the household that the person who connected the feed is in (and isn't in this one
 * yet) is skipped: the two parents share one bank, so a second jar with the same login
 * would count every charge twice. Accounts already here before keep syncing. Matching is by
 * SimpleFIN's account id, which is stable for one SimpleFIN login (a second login for the same
 * bank isn't spotted). Only a count and the other jar's id are stored; its name is shown only
 * to people who are in it.
 */
async function guardAccounts(connectionId: string, jarId: string, createdById: string | null, accounts: SfAccount[]): Promise<SfAccount[]> {
  // Phase 53: accounts a member left out of this jar aren't brought in at all (and the
  // per-account transaction checks again, for one left out while this sync runs).
  const out = await prisma.finAccount.findMany({ where: { jarId, source: "SIMPLEFIN", leftOut: true }, select: { externalId: true } });
  const leftOut = new Set(out.map((a) => a.externalId));
  accounts = accounts.filter((a) => !leftOut.has(a.id));
  const ids = accounts.map((a) => a.id);
  const jar = await prisma.moneyJar.findUnique({ where: { id: jarId }, select: { householdId: true } });
  const [here, elsewhere] = await Promise.all([
    prisma.finAccount.findMany({ where: { jarId, source: "SIMPLEFIN", externalId: { in: ids } }, select: { externalId: true } }),
    createdById && jar
      ? prisma.finAccount.findMany({
          where: { source: "SIMPLEFIN", externalId: { in: ids }, jarId: { not: jarId }, jar: { householdId: jar.householdId, members: { some: { personId: createdById } } } },
          select: { externalId: true, jarId: true },
        })
      : Promise.resolve([]),
  ]);
  const already = new Set(here.map((a) => a.externalId));
  const taken = new Map(elsewhere.filter((a) => !already.has(a.externalId)).map((a) => [a.externalId, a.jarId]));
  await prisma.jarConnection.update({
    where: { id: connectionId },
    data: { skippedAccounts: taken.size, skippedJarId: taken.size ? [...taken.values()][0] : null },
  });
  return accounts.filter((a) => !taken.has(a.id));
}

/** `today`: the sync's civil day, which a balance is recorded under (Phase 34's net worth). */
async function applySimpleFin(jarId: string, accounts: SfAccount[], windowStartDay: string, today: string) {
  for (const a of accounts) {
    await prisma.$transaction(
      async (tx) => {
        // Left out after this sync began: leave it be (the lock is the row's own, taken here).
        const [held] = await tx.$queryRaw<{ leftOut: boolean }[]>`
          SELECT "leftOut" FROM "fin_account" WHERE "jarId" = ${jarId} AND "source" = 'SIMPLEFIN' AND "externalId" = ${a.id} FOR UPDATE`;
        if (held?.leftOut) return;
        const account = await tx.finAccount.upsert({
          where: { jarId_source_externalId: { jarId, source: "SIMPLEFIN", externalId: a.id } },
          create: { jarId, source: "SIMPLEFIN", externalId: a.id, name: a.name, org: a.org, currency: a.currency, balanceCents: a.balanceCents, availableCents: a.availableCents, balanceAt: a.balanceAt },
          update: { name: a.name, org: a.org, currency: a.currency, balanceCents: a.balanceCents, availableCents: a.availableCents, balanceAt: a.balanceAt },
          select: { id: true },
        });
        // Phase 34: one balance per account per day (a second sync that day replaces it), whether or
        // not the bank said when the balance was from: the hero number reads balanceCents either way.
        if (a.balanceCents != null) {
          const key = { accountId: account.id, day: asDate(today) };
          await tx.finBalanceDay.upsert({ where: { accountId_day: key }, create: { ...key, balanceCents: a.balanceCents }, update: { balanceCents: a.balanceCents } });
        }
        const existing = await tx.finTransaction.findMany({
          where: { accountId: account.id, source: "SIMPLEFIN", externalId: { in: a.transactions.map((t) => t.id) } },
          select: { id: true, externalId: true, amountCents: true, pending: true, postedOn: true, description: true, payee: true, state: true, merchantName: true },
        });
        const byExt = new Map(existing.map((e) => [e.externalId, e]));
        const fresh = a.transactions.filter((t) => !byExt.has(t.id));
        if (fresh.length) {
          await tx.finTransaction.createMany({
            data: fresh.map((t) => ({
              jarId,
              accountId: account.id,
              source: "SIMPLEFIN" as const,
              externalId: t.id,
              postedOn: asDate(t.postedOn),
              amountCents: t.amountCents,
              description: t.description,
              payee: t.payee,
              memo: t.memo,
              pending: t.pending,
              merchantKey: merchantKeyOf(t) || "-",
            })),
            skipDuplicates: true,
          });
        }
        for (const t of a.transactions) {
          const e = byExt.get(t.id);
          if (!e) continue;
          const changed =
            e.amountCents !== t.amountCents || e.pending !== t.pending || day(e.postedOn) !== t.postedOn || e.description !== t.description || e.payee !== t.payee;
          if (changed || e.state === "SUPERSEDED") {
            await tx.finTransaction.update({
              where: { id: e.id },
              data: {
                amountCents: t.amountCents,
                pending: t.pending,
                postedOn: asDate(t.postedOn),
                description: t.description,
                payee: t.payee,
                memo: t.memo,
                // A Privacy merchant, once matched, still wins (it's the real name).
                ...(e.merchantName ? {} : { merchantKey: merchantKeyOf(t) || "-" }),
                ...(e.state === "SUPERSEDED" ? { state: "ACTIVE" } : {}),
              },
            });
          }
        }
        const pending = await tx.finTransaction.findMany({
          where: { accountId: account.id, source: "SIMPLEFIN", state: "ACTIVE", pending: true },
          select: { id: true, externalId: true, postedOn: true, amountCents: true },
        });
        const gone = supersededPending(
          pending.map((p) => ({ ...p, postedOn: day(p.postedOn) })),
          new Set(a.transactions.map((t) => t.id)),
          windowStartDay,
        );
        if (gone.length) await tx.finTransaction.updateMany({ where: { id: { in: gone } }, data: { state: "SUPERSEDED" } });
        await dedupeAccount(tx, jarId, account.id);
      },
      { timeout: 30_000 },
    );
  }
  await enrichPrivacy(prisma, jarId);
}

/** Rule 3 for one account: statement rows that are the same money as feed rows. */
export async function dedupeAccount(tx: Tx, jarId: string, accountId: string) {
  const rows = await tx.finTransaction.findMany({
    where: { accountId, state: "ACTIVE" },
    select: { id: true, source: true, postedOn: true, amountCents: true },
  });
  const manual = rows.filter((r) => r.source === "MANUAL").map((r) => ({ ...r, postedOn: day(r.postedOn) }));
  const feed = rows.filter((r) => r.source === "SIMPLEFIN").map((r) => ({ ...r, postedOn: day(r.postedOn) }));
  if (!manual.length || !feed.length) return;
  // Pairs a person called "two different charges" are never paired again. Rows with a question
  // still open stay out of automatic matching until it's answered.
  const asked = await tx.reconcileIssue.findMany({
    where: { jarId, kind: "POSSIBLE_DUPLICATE", OR: [{ resolution: "DIFFERENT" }, { resolvedAt: null }] },
    select: { key: true, resolvedAt: true, txnId: true, otherTxnId: true },
  });
  const waiting = new Set(asked.filter((a) => a.resolvedAt == null).flatMap((a) => [a.txnId, a.otherTxnId]).filter((id): id is string => id != null));
  const { same, possible } = findDuplicates(
    manual.filter((m) => !waiting.has(m.id)),
    feed.filter((f) => !waiting.has(f.id)),
    new Set(asked.map((a) => a.key)),
  );
  for (const [m, f] of same) {
    await tx.finTransaction.update({ where: { id: m }, data: { state: "DUPLICATE", duplicateOfId: f } });
    await carryCategory(tx, m, f);
  }
  if (possible.length) {
    await tx.reconcileIssue.createMany({
      data: possible.map(([m, f]) => ({ jarId, key: dupKey(m, f), kind: "POSSIBLE_DUPLICATE" as const, txnId: m, otherTxnId: f, accountId })),
      skipDuplicates: true,
    });
  }
}

/** Fills in the real merchant and card nickname on bank rows paid through Privacy.com. */
export async function enrichPrivacy(db: Tx | typeof prisma, jarId: string, now: Date = new Date()) {
  const charges = await db.privacyCharge.findMany({
    where: { jarId, matchedTxnId: null, occurredAt: { gte: new Date(now.getTime() - PRIVACY_MATCH_DAYS * DAY) } },
    select: { id: true, amountCents: true, occurredAt: true },
  });
  if (!charges.length) return;
  const times = charges.map((c) => c.occurredAt.getTime());
  const bank = await db.finTransaction.findMany({
    where: {
      jarId,
      state: "ACTIVE",
      merchantName: null,
      amountCents: { lt: 0 },
      postedOn: { gte: new Date(Math.min(...times) - 5 * DAY), lte: new Date(Math.max(...times) + 5 * DAY) },
    },
    select: { id: true, postedOn: true, amountCents: true, description: true },
  });
  const pairs = matchPrivacy(
    charges.map((c) => ({ id: c.id, amountCents: c.amountCents, occurredOn: day(c.occurredAt) })),
    bank.map((b) => ({ ...b, postedOn: day(b.postedOn) })),
  );
  for (const [chargeId, txnId] of pairs) {
    const charge = await db.privacyCharge.update({ where: { id: chargeId }, data: { matchedTxnId: txnId }, select: { merchant: true, cardMemo: true } });
    const row = await db.finTransaction.findUniqueOrThrow({ where: { id: txnId }, select: { description: true, payee: true, categorySource: true } });
    await db.finTransaction.update({
      where: { id: txnId },
      data: {
        merchantName: charge.merchant,
        privacyCardMemo: charge.cardMemo,
        merchantKey: merchantKeyOf({ merchantName: charge.merchant, ...row }) || "-",
        // Re-guess an automatic category with the real merchant (a person's pick stays).
        ...(row.categorySource === "PERSON" ? {} : { categoryId: null, categorySource: null }),
      },
    });
  }
}

/**
 * A statement file into one account. Re-importing the same file adds nothing. Phase 52: a row
 * another import already brought under a different id (an OFX and a CSV of the same month) is
 * folded in rather than added twice, and the new rows remember their import (`importId`), so
 * the whole file can be removed again.
 */
export async function importRows(jarId: string, accountId: string, rows: ImportedRow[], opts: { importId?: string } = {}): Promise<{ added: number; already: number }> {
  return prisma.$transaction(
    async (tx) => {
      const fresh = await notAlreadyHere(tx, accountId, rows);
      const { count } = await tx.finTransaction.createMany({
        data: fresh.map((r) => ({
          jarId,
          accountId,
          source: "MANUAL" as const,
          externalId: r.externalId,
          postedOn: asDate(r.postedOn),
          amountCents: r.amountCents,
          description: r.description,
          memo: r.memo,
          merchantKey: merchantKeyOf(r) || "-",
          importId: opts.importId ?? null,
        })),
        skipDuplicates: true,
      });
      await dedupeAccount(tx, jarId, accountId);
      await enrichPrivacy(tx, jarId);
      return { added: count, already: rows.length - count };
    },
    { timeout: 60_000 },
  ).then(async (result) => {
    await organizeSafely(jarId);
    return result;
  });
}

/** Same day, same amount, same words: the same charge, whichever file or reader brought it. */
const rowKey = (day: string, cents: number, description: string) => `${day}|${cents}|${description.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** The rows not in this account yet, by their id or, under another id, by day, amount and words. */
async function notAlreadyHere(tx: Tx, accountId: string, rows: ImportedRow[]): Promise<ImportedRow[]> {
  if (!rows.length) return rows;
  const days = rows.map((r) => r.postedOn).sort();
  const existing = await tx.finTransaction.findMany({
    where: { accountId, source: "MANUAL", state: "ACTIVE", postedOn: { gte: asDate(days[0]), lte: asDate(days[days.length - 1]) } },
    select: { externalId: true, postedOn: true, amountCents: true, description: true },
  });
  const newIds = new Set(rows.map((r) => r.externalId));
  const known = new Set(existing.map((e) => e.externalId));
  // How many rows like this are here under ids this file doesn't have: each takes one new row.
  const others = new Map<string, number>();
  for (const e of existing) {
    if (newIds.has(e.externalId)) continue;
    const key = rowKey(day(e.postedOn), e.amountCents, e.description);
    others.set(key, (others.get(key) ?? 0) + 1);
  }
  return rows.filter((r) => {
    if (known.has(r.externalId)) return true; // skipDuplicates counts it as already here
    const key = rowKey(r.postedOn, r.amountCents, r.description);
    const left = others.get(key) ?? 0;
    if (left === 0) return true;
    others.set(key, left - 1);
    return false;
  });
}

/** The tidy pass after money arrives: a failure there mustn't undo or misreport the arrival. */
async function organizeSafely(jarId: string, now?: Date) {
  try {
    await organizeJar(jarId, now);
  } catch (err) {
    captureError(new Error(`money jar tidy failed (jar ${jarId}): ${err instanceof Error ? err.constructor.name : "unknown"}`));
  }
}

/**
 * When a statement row folds into a feed row, what a person (or the tidy pass) attached to it
 * comes along: a person's category, and a grocery trip link, so the folded row doesn't hold
 * the trip where nobody can see it. Phase 27: and a surprise mark, so the row that stays
 * doesn't show the gift (lib/finance/gifts.ts).
 */
async function carryCategory(db: Tx, fromId: string, toId: string) {
  const from = await db.finTransaction.findUnique({
    where: { id: fromId },
    select: { categoryId: true, categorySource: true, purchaseId: true, purchaseLinkedBy: true, giftById: true, giftHiddenFrom: true, giftRevealOn: true, giftCopiedFromId: true },
  });
  if (!from) return;
  const today = todayCivil();
  if (from.giftRevealOn && from.giftRevealOn > civilDate(today)) {
    await db.finTransaction.updateMany({
      where: { id: toId, OR: [{ giftRevealOn: null }, { giftRevealOn: { lte: civilDate(today) } }] },
      data: { giftById: from.giftById, giftHiddenFrom: from.giftHiddenFrom, giftRevealOn: from.giftRevealOn, giftCopiedFromId: from.giftCopiedFromId ?? fromId },
    });
  }
  if (from.categorySource === "PERSON") {
    await db.finTransaction.updateMany({
      where: { id: toId, OR: [{ categorySource: null }, { categorySource: { in: ["AUTO", "RULE"] } }] },
      data: { categoryId: from.categoryId, categorySource: "PERSON" },
    });
  }
  // Phase 29: an order email matched to the folded row follows it (or, if the bank's row has
  // one already, goes back to be matched again).
  if (!(await db.mailOrder.count({ where: { matchedTxnId: toId } }))) {
    await db.mailOrder.updateMany({ where: { matchedTxnId: fromId }, data: { matchedTxnId: toId } });
  } else {
    await db.mailOrder.updateMany({ where: { matchedTxnId: fromId }, data: { matchedTxnId: null, matchedBy: null, matchedAt: null } });
  }
  if (from.purchaseId) {
    await db.finTransaction.updateMany({ where: { id: toId, purchaseId: null }, data: { purchaseId: from.purchaseId, purchaseLinkedBy: from.purchaseLinkedBy } });
    await db.finTransaction.update({ where: { id: fromId }, data: { purchaseId: null, purchaseLinkedBy: null } });
  }
}

/** "Same charge" / "Two different charges" / dismiss, for one open question. */
export async function resolveIssue(jarId: string, issueId: string, answer: "SAME" | "DIFFERENT" | "DISMISSED"): Promise<boolean> {
  const issue = await prisma.reconcileIssue.findFirst({ where: { id: issueId, jarId, resolvedAt: null } });
  if (!issue) return false;
  await prisma.$transaction(async (tx) => {
    if (answer === "SAME" && issue.kind === "POSSIBLE_DUPLICATE" && issue.txnId && issue.otherTxnId) {
      // txnId is the statement row, otherTxnId the bank feed's (the master).
      await tx.finTransaction.updateMany({ where: { id: issue.txnId, jarId, state: "ACTIVE" }, data: { state: "DUPLICATE", duplicateOfId: issue.otherTxnId } });
      await carryCategory(tx, issue.txnId, issue.otherTxnId);
      // Any other open question about that statement row is now moot.
      await tx.reconcileIssue.updateMany({
        where: { jarId, resolvedAt: null, id: { not: issue.id }, OR: [{ txnId: issue.txnId }, { otherTxnId: issue.txnId }] },
        data: { resolvedAt: new Date(), resolution: "DISMISSED" },
      });
    }
    if (answer === "DIFFERENT" && issue.txnId && issue.otherTxnId) await uncopyGift(tx, jarId, issue.txnId, issue.otherTxnId);
    await tx.reconcileIssue.update({ where: { id: issue.id }, data: { resolvedAt: new Date(), resolution: answer } });
  });
  return true;
}

/**
 * Phase 27: "Two different charges" — a surprise mark copied across the pair (because it
 * might have been the same charge, lib/finance/gifts.ts) comes off the row it was copied to.
 */
async function uncopyGift(tx: Tx, jarId: string, aId: string, bId: string) {
  const rows = await tx.finTransaction.findMany({ where: { jarId, id: { in: [aId, bId] } }, select: { id: true, giftCopiedFromId: true } });
  const [a, b] = [rows.find((r) => r.id === aId), rows.find((r) => r.id === bId)];
  if (!a || !b) return;
  const rootA = a.giftCopiedFromId ?? a.id;
  const rootB = b.giftCopiedFromId ?? b.id;
  if (rootA !== rootB) return;
  const copy = a.giftCopiedFromId ? a : b.giftCopiedFromId ? b : null;
  if (!copy) return;
  await tx.finTransaction.update({ where: { id: copy.id }, data: { giftById: null, giftHiddenFrom: [], giftRevealOn: null, giftCopiedFromId: null } });
}
