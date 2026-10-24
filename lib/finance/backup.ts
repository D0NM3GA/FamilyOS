import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { prisma, type Tx } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { BillCadence, FinCategoryKind, FinCategorySource, FinHoldingKind, FinLinkSource, FinSource, FinTxnState, RecurringStatus } from "@/app/generated/prisma/enums";
import type { SealedMoney } from "@/lib/backup/schema";
import type { MoneyRestoreContext, MoneyRestoreCounts } from "@/lib/backup/build";
import { hiddenFromWhere, visibleToWhere } from "./gifts";

/**
 * Phase 28: money in backups. Two shapes, both built only here (lib/finance), because a jar
 * is private to its members:
 *
 * 1. Sealed, inside the admin's household backup (lib/backup, format v7). Every jar in the
 *    household as gzipped JSON, encrypted with INTEGRATION_ENCRYPTION_KEY (lib/crypto). The
 *    admin holding the file can't read it; only a server with the same key can. The AAD is
 *    household-independent on purpose, so a restore onto a fresh server (a new household
 *    row) can still open it. Phase 28.5 restores from it (planMoneyRestore below).
 *    Version 2 seals a digest of the file's own people table: the people list is plaintext
 *    in the file, and jar members are people ids, so without the binding an admin could edit
 *    who an id is (say, give grandma's id his email) and be restored into her jar.
 * 2. Readable, a person's own copy (POST /api/backup/my-money): only the jars they're in and
 *    only what they can see in the app. Surprises hidden from them are left out, and so is
 *    anything that would name one (a Privacy charge not matched to a row they see, a
 *    category rule or Bills answer whose merchant only appears on hidden rows).
 *
 * Never in either: bank connections (their secrets are bound to the jar id they were saved
 * under; members reconnect), review questions (re-derived), FinAlertSent.
 */

const MONEY_AAD = "familyos-backup-money-v1";

export class MoneySealError extends Error {}

const iso = z.iso.datetime();
const day = z.iso.date();
// Generous on purpose: these mirror what the feeds may store (lib/finance/simplefin.ts), and
// the schema guards the way back in (unsealMoney), never the way out.
const text = z.string().max(10_000);
const nullableText = text.nullable();
const id = z.string().min(1).max(64);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const moneySectionSchema = z.object({
  version: z.literal(3),
  /** peopleDigest() of the household's people when this was sealed (same transaction). */
  peopleDigest: z.string().length(64),
  jars: z.array(
    z.object({
      id,
      name: text,
      emoji: nullableText,
      // Phase 32; older backups have none.
      cushionCents: z.number().int().nullable().default(null),
      createdAt: iso,
      members: z.array(
        z.object({
          personId: id,
          /** v3: who they sign in as (their Microsoft address, else their profile address), lowercased. */
          signInEmail: z.string().max(320).nullable(),
          createdAt: iso,
          alertBills: z.boolean(),
          alertSync: z.boolean(),
          alertOverBudget: z.boolean(),
          alertLowBalance: z.boolean().default(true),
        }),
      ),
      accounts: z.array(
        z.object({
          id,
          source: z.enum(FinSource),
          externalId: text,
          name: text,
          org: nullableText,
          currency: z.string().max(64),
          balanceCents: z.number().int().nullable(),
          availableCents: z.number().int().nullable(),
          balanceAt: iso.nullable(),
          spending: z.boolean().default(false),
          // Phase 53; older backups have none.
          leftOut: z.boolean().default(false),
          createdAt: iso,
        }),
      ),
      categories: z.array(
        z.object({
          id,
          key: text,
          name: text,
          emoji: nullableText,
          kind: z.enum(FinCategoryKind),
          sortOrder: z.number().int(),
          budgetCents: z.number().int().nullable(),
          // Phase 31; older backups have none of these.
          rollover: z.boolean().default(false),
          rolloverFrom: z.string().regex(MONTH).nullable().default(null),
          goalCents: z.number().int().nullable().default(null),
          goalMonth: z.string().regex(MONTH).nullable().default(null),
          // Phase 37: keys of categories removed into this one; older backups have none.
          absorbedKeys: z.array(text).max(100).default([]),
          createdAt: iso,
        }),
      ),
      rules: z.array(z.object({ id, key: text, categoryId: id, createdAt: iso })),
      recurring: z.array(z.object({ id, key: text, status: z.enum(RecurringStatus), reviewedAt: iso })),
      transactions: z.array(
        z.object({
          id,
          accountId: id,
          source: z.enum(FinSource),
          externalId: text,
          postedOn: day,
          amountCents: z.number().int(),
          description: text,
          payee: nullableText,
          memo: nullableText,
          pending: z.boolean(),
          state: z.enum(FinTxnState),
          duplicateOfId: id.nullable(),
          merchantName: nullableText,
          privacyCardMemo: nullableText,
          merchantKey: text,
          categoryId: id.nullable(),
          categorySource: z.enum(FinCategorySource).nullable(),
          purchaseId: id.nullable(),
          purchaseLinkedBy: z.enum(FinLinkSource).nullable(),
          giftById: id.nullable(),
          giftHiddenFrom: z.array(id),
          giftRevealOn: day.nullable(),
          giftCopiedFromId: id.nullable(),
          createdAt: iso,
        }),
      ),
      // Bills added by hand (lib/finance/manual-bills.ts); older backups have none. Who added
      // one isn't kept: people are remapped on restore and it only labels the row.
      manualBills: z
        .array(
          z.object({
            id,
            name: text,
            amountCents: z.number().int(),
            cadence: z.enum(BillCadence),
            nextDue: day,
            matchKey: text,
            createdAt: iso,
          }),
        )
        .default([]),
      // Phase 34, Net worth; older backups have none. Who set a value is in the jar's history,
      // which isn't backed up.
      balanceDays: z.array(z.object({ accountId: id, day, balanceCents: z.number().int() })).default([]),
      holdings: z.array(z.object({ id, name: text, kind: z.enum(FinHoldingKind), createdAt: iso })).default([]),
      holdingValues: z.array(z.object({ holdingId: id, valuedOn: day, valueCents: z.number().int(), createdAt: iso })).default([]),
      privacyCharges: z.array(
        z.object({
          id,
          token: text,
          cardToken: nullableText,
          cardMemo: nullableText,
          cardLast4: z.string().max(64).nullable(),
          merchant: text,
          amountCents: z.number().int(),
          status: text,
          occurredAt: iso,
          matchedTxnId: id.nullable(),
        }),
      ),
    }),
  ),
});
export type MoneySection = z.infer<typeof moneySectionSchema>;

const isoOf = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every jar in the household, everything a restore would need (no connection secrets). Not
 * validated here: a row the schema didn't expect must never make every household backup
 * (and every restore's snapshot) fail. Restore validates when it opens the box.
 */
export async function readHouseholdMoney(tx: Tx | typeof prisma, householdId: string): Promise<MoneySection> {
  const people = await tx.person.findMany({ where: { householdId }, select: { id: true, email: true, isHouseholdMember: true, role: true } });
  const jars = await tx.moneyJar.findMany({
    where: { householdId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      cushionCents: true,
      createdAt: true,
      members: {
        select: {
          personId: true,
          createdAt: true,
          alertBills: true,
          alertSync: true,
          alertOverBudget: true,
          alertLowBalance: true,
          person: { select: { email: true, authUser: { select: { email: true } } } },
        },
      },
      accounts: {
        select: {
          id: true,
          source: true,
          externalId: true,
          name: true,
          org: true,
          currency: true,
          balanceCents: true,
          availableCents: true,
          balanceAt: true,
          spending: true,
          leftOut: true,
          createdAt: true,
        },
      },
      categories: { select: { id: true, key: true, name: true, emoji: true, kind: true, sortOrder: true, budgetCents: true, rollover: true, rolloverFrom: true, goalCents: true, goalMonth: true, absorbedKeys: true, createdAt: true } },
      rules: { select: { id: true, key: true, categoryId: true, createdAt: true } },
      recurring: { select: { id: true, key: true, status: true, reviewedAt: true } },
      transactions: {
        select: {
          id: true,
          accountId: true,
          source: true,
          externalId: true,
          postedOn: true,
          amountCents: true,
          description: true,
          payee: true,
          memo: true,
          pending: true,
          state: true,
          duplicateOfId: true,
          merchantName: true,
          privacyCardMemo: true,
          merchantKey: true,
          categoryId: true,
          categorySource: true,
          purchaseId: true,
          purchaseLinkedBy: true,
          giftById: true,
          giftHiddenFrom: true,
          giftRevealOn: true,
          giftCopiedFromId: true,
          createdAt: true,
        },
      },
      privacy: { select: { id: true, token: true, cardToken: true, cardMemo: true, cardLast4: true, merchant: true, amountCents: true, status: true, occurredAt: true, matchedTxnId: true } },
      manualBills: { select: { id: true, name: true, amountCents: true, cadence: true, nextDue: true, matchKey: true, createdAt: true } },
      holdings: { select: { id: true, name: true, kind: true, createdAt: true, values: { select: { valuedOn: true, valueCents: true, createdAt: true } } } },
    },
  });
  const days = await tx.finBalanceDay.findMany({ where: { account: { jar: { householdId } } }, select: { accountId: true, day: true, balanceCents: true } });
  const jarOfAccount = new Map(jars.flatMap((j) => j.accounts.map((a) => [a.id, j.id] as const)));
  return {
    version: 3,
    peopleDigest: peopleDigest(people),
    jars: jars.map((j) => ({
      id: j.id,
      name: j.name,
      emoji: j.emoji,
      cushionCents: j.cushionCents,
      createdAt: isoOf(j.createdAt),
      members: j.members.map(({ person, ...m }) => ({ ...m, signInEmail: normEmail(person.authUser?.email ?? person.email), createdAt: isoOf(m.createdAt) })),
      accounts: j.accounts.map((a) => ({ ...a, balanceAt: isoOrNull(a.balanceAt), createdAt: isoOf(a.createdAt) })),
      categories: j.categories.map((c) => ({ ...c, createdAt: isoOf(c.createdAt) })),
      rules: j.rules.map((r) => ({ ...r, createdAt: isoOf(r.createdAt) })),
      recurring: j.recurring.map((r) => ({ ...r, reviewedAt: isoOf(r.reviewedAt) })),
      transactions: j.transactions.map((t) => ({
        ...t,
        postedOn: dayOf(t.postedOn),
        giftHiddenFrom: t.giftHiddenFrom ?? [],
        giftRevealOn: t.giftRevealOn ? dayOf(t.giftRevealOn) : null,
        createdAt: isoOf(t.createdAt),
      })),
      privacyCharges: j.privacy.map((p) => ({ ...p, occurredAt: isoOf(p.occurredAt) })),
      manualBills: j.manualBills.map((b) => ({ ...b, nextDue: dayOf(b.nextDue), createdAt: isoOf(b.createdAt) })),
      balanceDays: days.filter((d) => jarOfAccount.get(d.accountId) === j.id).map((d) => ({ ...d, day: dayOf(d.day) })),
      holdings: j.holdings.map((h) => ({ id: h.id, name: h.name, kind: h.kind, createdAt: isoOf(h.createdAt) })),
      holdingValues: j.holdings.flatMap((h) => h.values.map((v) => ({ holdingId: h.id, valuedOn: dayOf(v.valuedOn), valueCents: v.valueCents, createdAt: isoOf(v.createdAt) }))),
    })),
  };
}

/** The BackupHooks.sealMoney for lib/backup: null when the household has no jars. */
export async function sealMoney(tx: Tx | typeof prisma, householdId: string): Promise<SealedMoney | null> {
  const section = await readHouseholdMoney(tx, householdId);
  return section.jars.length === 0 ? null : sealSection(section);
}

export function sealSection(section: MoneySection): SealedMoney {
  const box = encryptBytes(gzipSync(Buffer.from(JSON.stringify(section), "utf8")), MONEY_AAD);
  return {
    version: 1,
    cipher: "aes-256-gcm",
    encoding: "gzip+json",
    keyVersion: 1,
    jarCount: section.jars.length,
    nonce: box.iv.toString("base64"),
    tag: box.authTag.toString("base64"),
    sealed: box.encryptedValue.toString("base64"),
  };
}

/** Opens a sealed section (Phase 28.5's restore). Fixed messages only: never file content. */
export function unsealMoney(box: SealedMoney): MoneySection {
  let json: unknown;
  try {
    const plain = gunzipSync(
      decryptBytes({ iv: Buffer.from(box.nonce, "base64"), authTag: Buffer.from(box.tag, "base64"), encryptedValue: Buffer.from(box.sealed, "base64") }, MONEY_AAD),
      // Only this server's key can seal one, but a cap costs nothing: a family's jars are megabytes.
      { maxOutputLength: 64 * 1024 * 1024 },
    );
    json = JSON.parse(plain.toString("utf8"));
  } catch {
    throw new MoneySealError("This file's money jars were sealed by a server with a different key (INTEGRATION_ENCRYPTION_KEY), or the file was changed.");
  }
  const version = (json as { version?: unknown } | null)?.version;
  if (version === 1 || version === 2) {
    throw new MoneySealError("This file's money jars were sealed before they could be put back. Make a fresh backup to restore them.");
  }
  const parsed = moneySectionSchema.safeParse(json);
  if (!parsed.success) throw new MoneySealError("This file's money jars couldn't be read.");
  return parsed.data;
}

// ---- a person's own copy ---------------------------------------------------------------

export const MY_MONEY_FORMAT = "familyos-money-backup";

/**
 * The jars `personId` is in, as they see them on `today` (a civil day, lib/finance/budget.ts
 * todayCivil). Readable on purpose: it's their own data. Ids of other people aren't needed
 * in a personal copy, so members are first names and a surprise shows only who it's for
 * when the person marked it themselves.
 */
export async function buildMyMoneyBackup(personId: string, householdId: string, today: string, now: Date = new Date()) {
  const visible = visibleToWhere(personId, today);
  const jars = await prisma.moneyJar.findMany({
    where: { householdId, members: { some: { personId } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      createdAt: true,
      cushionCents: true,
      members: { select: { person: { select: { id: true, firstName: true } } } },
      accounts: {
        select: {
          id: true,
          source: true,
          name: true,
          org: true,
          currency: true,
          balanceCents: true,
          availableCents: true,
          balanceAt: true,
          spending: true,
          balanceDays: { orderBy: { day: "asc" }, select: { day: true, balanceCents: true } },
        },
      },
      categories: { select: { id: true, key: true, name: true, emoji: true, kind: true, budgetCents: true, rollover: true, rolloverFrom: true, goalCents: true, goalMonth: true } },
      rules: { select: { key: true, categoryId: true } },
      recurring: { select: { key: true, status: true, reviewedAt: true } },
      manualBills: { select: { name: true, amountCents: true, cadence: true, nextDue: true } },
      holdings: { orderBy: { createdAt: "asc" }, select: { name: true, kind: true, values: { orderBy: { valuedOn: "asc" }, select: { valuedOn: true, valueCents: true } } } },
    },
  });
  const out = [];
  for (const j of jars) {
    const [rows, hidden] = await Promise.all([
      // Only rows the app shows (ACTIVE): a duplicate or superseded twin of a surprise can lack
      // the mark, and nobody sees those rows anyway.
      prisma.finTransaction.findMany({
        where: { jarId: j.id, state: "ACTIVE", ...visible },
        orderBy: [{ postedOn: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          accountId: true,
          postedOn: true,
          amountCents: true,
          description: true,
          payee: true,
          memo: true,
          pending: true,
          merchantName: true,
          privacyCardMemo: true,
          merchantKey: true,
          categoryId: true,
          categorySource: true,
          giftById: true,
          giftHiddenFrom: true,
          giftRevealOn: true,
          privacyCharges: {
            select: { merchant: true, amountCents: true, status: true, occurredAt: true, cardToken: true, cardMemo: true, cardLast4: true },
          },
        },
      }),
      prisma.finTransaction.count({ where: { jarId: j.id, state: "ACTIVE", ...hiddenFromWhere(personId, today) } }),
    ]);
    const names = new Map(j.members.map((m) => [m.person.id, m.person.firstName]));
    // Only rules and Bills answers whose merchant (or Privacy card) appears on a row they see.
    const seenKeys = new Set(rows.flatMap((r) => [r.merchantKey, ...r.privacyCharges.flatMap((p) => (p.cardToken ? [`privacy:${p.cardToken}`] : []))]));
    out.push({
      name: j.name,
      emoji: j.emoji,
      cushionCents: j.cushionCents,
      createdAt: isoOf(j.createdAt),
      members: j.members.map((m) => m.person.firstName),
      accounts: j.accounts.map(({ balanceDays, ...a }) => ({
        ...a,
        balanceAt: isoOrNull(a.balanceAt),
        balanceHistory: balanceDays.map((d) => ({ day: dayOf(d.day), balanceCents: d.balanceCents })),
      })),
      categories: j.categories,
      alwaysRules: j.rules.filter((r) => seenKeys.has(r.key)),
      billAnswers: j.recurring.filter((r) => seenKeys.has(r.key)).map((r) => ({ ...r, reviewedAt: isoOf(r.reviewedAt) })),
      // Every member sees these on the Bills page (they're never a surprise).
      billsAddedByHand: j.manualBills.map((b) => ({ ...b, nextDue: dayOf(b.nextDue) })),
      // Net worth's things typed in (never a surprise either). A LOAN's values are owed.
      ownedOrOwed: j.holdings.map((h) => ({ ...h, values: h.values.map((v) => ({ valuedOn: dayOf(v.valuedOn), valueCents: v.valueCents })) })),
      transactions: rows.map(({ giftById, giftHiddenFrom, giftRevealOn, privacyCharges, postedOn, ...r }) => ({
        ...r,
        postedOn: dayOf(postedOn),
        privacyCharges: privacyCharges.map((p) => ({ merchant: p.merchant, amountCents: p.amountCents, status: p.status, cardMemo: p.cardMemo, cardLast4: p.cardLast4, occurredAt: isoOf(p.occurredAt) })),
        ...(giftById === personId && giftRevealOn
          ? { surprise: { for: (giftHiddenFrom ?? []).map((pid) => names.get(pid) ?? "someone"), showsOn: dayOf(giftRevealOn) } }
          : {}),
      })),
      surprisesNotIncluded: hidden,
    });
  }
  return { format: MY_MONEY_FORMAT, version: 1, exportedAt: isoOf(now), jars: out };
}

// ---- Phase 28.5: putting jars back ---------------------------------------------------------

type PersonForDigest = { id: string; email: string | null; isHouseholdMember: boolean; role: string | null };

const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

/** Who each person id is, as one hash: sealed with the jars, re-computed from the file on restore. */
export function peopleDigest(people: PersonForDigest[]): string {
  const rows = [...people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((p) => [p.id, p.email, p.isHouseholdMember, p.role]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const ADULT = new Set(["ADULT", "ADMIN"]);
type Rejection = { ok: false; errors: string[] };

/**
 * The rows to insert, with new ids, from an opened section. Pure.
 *
 * Who a member is, is decided by who they SIGN IN as (sealed with the jar), never by a
 * profile's email, which any adult can edit (a profile email changed to grandma's would
 * otherwise inherit her jar):
 * - someone signed in here with that Microsoft address → that person, if still a grown-up
 *   member of the household;
 * - nobody yet (a rebuilt server) → the file's own person row, restored unlinked, if the file
 *   says they're a grown-up member and nothing here claimed that row by email; it's adopted
 *   on their first sign-in (lib/active-profile.ts, by email), so it gets the sign-in address
 *   as its email if it had none;
 * - anything else → dropped. A jar left with nobody is skipped: nobody could open it.
 * Surprise marks re-point through the same answers.
 */
export function planMoneyRestore(section: MoneySection, ctx: MoneyRestoreContext, opts: { householdId: string; newId?: () => string }) {
  const newId = opts.newId ?? randomUUID;
  const errors = checkSection(section);
  if (peopleDigest(ctx.filePeople) !== section.peopleDigest) {
    errors.unshift("This file's people list was changed after it was made, so its money jars can't be put back. Use an unedited backup.");
  }
  if (errors.length) return { ok: false as const, errors };

  const filePerson = new Map(ctx.filePeople.map((p) => [p.id, p]));
  const bySignIn = new Map(ctx.linked.filter((l) => normEmail(l.authEmail)).map((l) => [normEmail(l.authEmail)!, l]));
  const grownUp = (p: { isHouseholdMember: boolean; role: string | null }) => p.isHouseholdMember && p.role != null && ADULT.has(p.role);
  type Resolved = { id: string; waiting: boolean; emailFix: string | null };
  const resolve = (m: { personId: string; signInEmail: string | null }): Resolved | null => {
    const sign = normEmail(m.signInEmail);
    const live = sign ? bySignIn.get(sign) : undefined;
    if (live) return grownUp(live) ? { id: live.id, waiting: false, emailFix: null } : null;
    // The file's row was claimed here by someone with a different sign-in: not them.
    if (!sign || ctx.matched.has(m.personId)) return null;
    const p = filePerson.get(m.personId);
    if (!p || !grownUp(p)) return null;
    const own = normEmail(p.email);
    if (own && own !== sign) return null;
    return { id: ctx.people.get(m.personId)!, waiting: true, emailFix: own ? null : sign };
  };
  const emailFixes = new Map<string, string>();

  const counts: MoneyRestoreCounts = { jars: 0, jarsSkipped: 0, membersKept: 0, membersWaiting: 0, membersDropped: 0 };
  const rows = {
    jars: [] as { id: string; householdId: string; name: string; emoji: string | null; cushionCents: number | null; createdAt: Date }[],
    members: [] as { jarId: string; personId: string; createdAt: Date; alertBills: boolean; alertSync: boolean; alertOverBudget: boolean; alertLowBalance: boolean }[],
    accounts: [] as Record<string, unknown>[],
    categories: [] as Record<string, unknown>[],
    rules: [] as Record<string, unknown>[],
    recurring: [] as Record<string, unknown>[],
    /** In passes: each pass's duplicateOfId points only at rows of earlier passes. */
    transactionPasses: [] as Record<string, unknown>[][],
    privacy: [] as Record<string, unknown>[],
    manualBills: [] as Record<string, unknown>[],
    balanceDays: [] as Record<string, unknown>[],
    holdings: [] as Record<string, unknown>[],
    holdingValues: [] as Record<string, unknown>[],
    /** Restored people who'll be adopted by email but have none: given their sign-in address. */
    emailFixes: [] as { personId: string; email: string }[],
  };
  const txnIds = new Map<string, string>();
  const pending: { jarId: string; people: Map<string, string>; t: MoneySection["jars"][number]["transactions"][number] }[] = [];

  for (const jar of section.jars) {
    const resolved = jar.members.map((m) => ({ m, r: resolve(m) })).filter((x): x is { m: (typeof jar.members)[number]; r: Resolved } => x.r != null);
    // Two members resolving to one person (shouldn't happen): one membership.
    const kept = [...new Map(resolved.map((x) => [x.r.id, x])).values()];
    counts.membersDropped += jar.members.length - kept.length;
    if (kept.length === 0) {
      counts.jarsSkipped++;
      continue;
    }
    counts.jars++;
    counts.membersKept += kept.length;
    counts.membersWaiting += kept.filter((x) => x.r.waiting).length;
    const jarPeople = new Map(kept.map((x) => [x.m.personId, x.r.id]));
    const jarId = newId();
    rows.jars.push({ id: jarId, householdId: opts.householdId, name: jar.name, emoji: jar.emoji, cushionCents: jar.cushionCents, createdAt: new Date(jar.createdAt) });
    for (const { m, r } of kept) {
      rows.members.push({
        jarId,
        personId: r.id,
        createdAt: new Date(m.createdAt),
        alertBills: m.alertBills,
        alertSync: m.alertSync,
        alertOverBudget: m.alertOverBudget,
        alertLowBalance: m.alertLowBalance,
      });
      if (r.emailFix) emailFixes.set(r.id, r.emailFix);
    }
    const accounts = new Map(jar.accounts.map((a) => [a.id, newId()]));
    const categories = new Map(jar.categories.map((c) => [c.id, newId()]));
    for (const a of jar.accounts) {
      rows.accounts.push({ ...a, id: accounts.get(a.id), jarId, balanceAt: a.balanceAt ? new Date(a.balanceAt) : null, createdAt: new Date(a.createdAt) });
    }
    for (const c of jar.categories) rows.categories.push({ ...c, id: categories.get(c.id), jarId, createdAt: new Date(c.createdAt) });
    for (const r of jar.rules) rows.rules.push({ ...r, id: newId(), jarId, categoryId: categories.get(r.categoryId), createdAt: new Date(r.createdAt) });
    for (const r of jar.recurring) rows.recurring.push({ ...r, id: newId(), jarId, reviewedAt: new Date(r.reviewedAt) });
    for (const t of jar.transactions) {
      txnIds.set(t.id, newId());
      pending.push({ jarId, people: jarPeople, t: { ...t, accountId: accounts.get(t.accountId)!, categoryId: t.categoryId ? (categories.get(t.categoryId) ?? null) : null } });
    }
    for (const b of jar.manualBills) {
      rows.manualBills.push({ ...b, id: newId(), jarId, nextDue: new Date(`${b.nextDue}T00:00:00Z`), createdAt: new Date(b.createdAt) });
    }
    for (const d of jar.balanceDays) rows.balanceDays.push({ accountId: accounts.get(d.accountId), day: new Date(`${d.day}T00:00:00Z`), balanceCents: d.balanceCents });
    const holdingIds = new Map(jar.holdings.map((h) => [h.id, newId()]));
    for (const h of jar.holdings) rows.holdings.push({ ...h, id: holdingIds.get(h.id), jarId, createdAt: new Date(h.createdAt) });
    for (const v of jar.holdingValues) {
      rows.holdingValues.push({ holdingId: holdingIds.get(v.holdingId), valuedOn: new Date(`${v.valuedOn}T00:00:00Z`), valueCents: v.valueCents, createdAt: new Date(v.createdAt) });
    }
    for (const p of jar.privacyCharges) {
      rows.privacy.push({ ...p, id: newId(), jarId, occurredAt: new Date(p.occurredAt), matchedTxnId: p.matchedTxnId ? (txnIds.get(p.matchedTxnId) ?? null) : null });
    }
  }

  rows.emailFixes = [...emailFixes].map(([personId, email]) => ({ personId, email }));
  const toRow = (jarId: string, people: Map<string, string>, t: MoneySection["jars"][number]["transactions"][number]) => {
    const person = (id: string | null) => (id != null ? (people.get(id) ?? null) : null);
    const hiddenFrom = t.giftHiddenFrom.map((id) => person(id)).filter((id): id is string => id != null);
    const marked = t.giftRevealOn != null && hiddenFrom.length > 0;
    const purchaseId = t.purchaseId ? (ctx.purchases.get(t.purchaseId) ?? null) : null;
    return {
      ...t,
      id: txnIds.get(t.id)!,
      jarId,
      postedOn: new Date(`${t.postedOn}T00:00:00Z`),
      createdAt: new Date(t.createdAt),
      duplicateOfId: t.duplicateOfId ? (txnIds.get(t.duplicateOfId) ?? null) : null,
      purchaseId,
      purchaseLinkedBy: purchaseId ? t.purchaseLinkedBy : t.purchaseLinkedBy === "PERSON" ? "PERSON" : null,
      giftById: marked ? person(t.giftById) : null,
      giftHiddenFrom: marked ? hiddenFrom : [],
      giftRevealOn: marked ? new Date(`${t.giftRevealOn}T00:00:00Z`) : null,
      giftCopiedFromId: marked && t.giftCopiedFromId ? (txnIds.get(t.giftCopiedFromId) ?? null) : null,
    };
  };
  // duplicateOfId is a self-reference: insert targets first.
  const placed = new Set<string>();
  let left = pending;
  while (left.length) {
    const pass = left.filter(({ t }) => !t.duplicateOfId || !txnIds.has(t.duplicateOfId) || placed.has(t.duplicateOfId));
    if (pass.length === 0) return { ok: false as const, errors: ["The file's money jars refer to each other in a loop, so they can't be put back."] };
    rows.transactionPasses.push(pass.map(({ jarId, people, t }) => toRow(jarId, people, t)));
    for (const { t } of pass) placed.add(t.id);
    left = left.filter(({ t }) => !placed.has(t.id));
  }
  return { ok: true as const, rows, counts };
}

/** Every reference inside the section resolves within its jar, and unique keys are unique. Counts only. */
function checkSection(section: MoneySection): string[] {
  let broken = 0;
  let dupes = 0;
  const seen = (keys: string[]) => keys.length - new Set(keys).size;
  for (const j of section.jars) {
    const accounts = new Set(j.accounts.map((a) => a.id));
    const categories = new Set(j.categories.map((c) => c.id));
    const txns = new Set(j.transactions.map((t) => t.id));
    for (const t of j.transactions) {
      if (!accounts.has(t.accountId)) broken++;
      if (t.categoryId && !categories.has(t.categoryId)) broken++;
      if (t.duplicateOfId && !txns.has(t.duplicateOfId)) broken++;
      if (t.giftCopiedFromId && !txns.has(t.giftCopiedFromId)) broken++;
    }
    for (const r of j.rules) if (!categories.has(r.categoryId)) broken++;
    for (const d of j.balanceDays) if (!accounts.has(d.accountId)) broken++;
    const holdings = new Set(j.holdings.map((h) => h.id));
    for (const v of j.holdingValues) if (!holdings.has(v.holdingId)) broken++;
    // A holding always has a value (the last one can't be taken off).
    const valued = new Set(j.holdingValues.map((v) => v.holdingId));
    for (const h of j.holdings) if (!valued.has(h.id)) broken++;
    dupes += seen(j.balanceDays.map((d) => `${d.accountId}|${d.day}`)) + seen(j.holdingValues.map((v) => `${v.holdingId}|${v.valuedOn}`));
    for (const p of j.privacyCharges) if (p.matchedTxnId && !txns.has(p.matchedTxnId)) broken++;
    dupes += seen([...j.members.map((m) => m.personId)]);
    dupes += seen(j.accounts.map((a) => `${a.source}|${a.externalId}`));
    dupes += seen(j.transactions.map((t) => `${t.accountId}|${t.source}|${t.externalId}`));
    dupes += seen(j.privacyCharges.map((p) => p.token));
    dupes += seen(j.categories.map((c) => c.key)) + seen(j.rules.map((r) => r.key)) + seen(j.recurring.map((r) => r.key));
  }
  const ids = section.jars.flatMap((j) => [j.id, ...j.accounts.map((a) => a.id), ...j.categories.map((c) => c.id), ...j.transactions.map((t) => t.id), ...j.holdings.map((h) => h.id)]);
  dupes += ids.length - new Set(ids).size;
  const errors: string[] = [];
  if (broken) errors.push(`The file's money jars have ${broken} reference(s) that don't resolve.`);
  if (dupes) errors.push(`The file's money jars have ${dupes} duplicate entr(ies).`);
  return errors;
}

function open(box: SealedMoney): { ok: true; section: MoneySection } | Rejection {
  try {
    return { ok: true, section: unsealMoney(box) };
  } catch (err) {
    return { ok: false, errors: [err instanceof MoneySealError ? err.message : "This file's money jars couldn't be read."] };
  }
}

/** BackupHooks.previewMoney: counts only, never names or contents. */
export function previewMoney(box: SealedMoney, ctx: MoneyRestoreContext): { ok: true; preview: MoneyRestoreCounts } | Rejection {
  const opened = open(box);
  if (!opened.ok) return opened;
  const plan = planMoneyRestore(opened.section, ctx, { householdId: "preview" });
  return plan.ok ? { ok: true, preview: plan.counts } : plan;
}

const CHUNK = 1000;
async function inChunks<T>(rows: T[], create: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await create(rows.slice(i, i + CHUNK));
}

/**
 * BackupHooks.restoreMoney: inside restore's transaction, after people and grocery trips are
 * in. Deletes every jar in the household (cascading accounts, rows, bank connections,
 * questions and sent-alert markers) and inserts the file's. Returns who was in a jar before,
 * so they're told.
 */
export async function restoreMoney(
  tx: Tx,
  householdId: string,
  box: SealedMoney,
  ctx: MoneyRestoreContext,
): Promise<{ ok: true; restored: MoneyRestoreCounts; previousMemberIds: string[] } | Rejection> {
  const opened = open(box);
  if (!opened.ok) return opened;
  const plan = planMoneyRestore(opened.section, ctx, { householdId });
  if (!plan.ok) return plan;
  const before = await tx.moneyJarMember.findMany({ where: { jar: { householdId } }, select: { personId: true } });
  await tx.moneyJar.deleteMany({ where: { householdId } });
  const r = plan.rows;
  await inChunks(r.jars, (data) => tx.moneyJar.createMany({ data }));
  for (const f of r.emailFixes) await tx.person.updateMany({ where: { id: f.personId, householdId, email: null }, data: { email: f.email } });
  await inChunks(r.members, (data) => tx.moneyJarMember.createMany({ data }));
  await inChunks(r.accounts, (data) => tx.finAccount.createMany({ data: data as Prisma.FinAccountCreateManyInput[] }));
  await inChunks(r.balanceDays, (data) => tx.finBalanceDay.createMany({ data: data as Prisma.FinBalanceDayCreateManyInput[] }));
  await inChunks(r.categories, (data) => tx.finCategory.createMany({ data: data as Prisma.FinCategoryCreateManyInput[] }));
  await inChunks(r.rules, (data) => tx.categoryRule.createMany({ data: data as Prisma.CategoryRuleCreateManyInput[] }));
  await inChunks(r.recurring, (data) => tx.recurringMark.createMany({ data: data as Prisma.RecurringMarkCreateManyInput[] }));
  for (const pass of r.transactionPasses) await inChunks(pass, (data) => tx.finTransaction.createMany({ data: data as Prisma.FinTransactionCreateManyInput[] }));
  await inChunks(r.privacy, (data) => tx.privacyCharge.createMany({ data: data as Prisma.PrivacyChargeCreateManyInput[] }));
  await inChunks(r.manualBills, (data) => tx.manualBill.createMany({ data: data as Prisma.ManualBillCreateManyInput[] }));
  await inChunks(r.holdings, (data) => tx.finHolding.createMany({ data: data as Prisma.FinHoldingCreateManyInput[] }));
  await inChunks(r.holdingValues, (data) => tx.finHoldingValue.createMany({ data: data as Prisma.FinHoldingValueCreateManyInput[] }));
  return { ok: true, restored: plan.counts, previousMemberIds: [...new Set(before.map((b) => b.personId))] };
}

const HOLD_MS = 5 * 60_000;

/**
 * Before a restore puts jars back: takes every bank connection's sync lease (lib/finance/sync.ts
 * claimConnections) so no on-visit, Sync now or background sync writes into jars the restore
 * is replacing. Refused (null) if a sync is running right now. `release` hands the leases
 * back if the restore didn't happen (after one, the connections are gone with their jars).
 */
export async function holdMoneySyncs(householdId: string, now: Date = new Date()): Promise<{ release: () => Promise<void> } | null> {
  const until = new Date(now.getTime() + HOLD_MS);
  const where = { jar: { householdId } };
  const total = await prisma.jarConnection.count({ where });
  const { count } = await prisma.jarConnection.updateMany({
    where: { ...where, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: until },
  });
  const release = async () => {
    await prisma.jarConnection.updateMany({ where: { ...where, leaseUntil: until }, data: { leaseUntil: null } });
  };
  if (count < total) {
    await release();
    return null;
  }
  return { release };
}
