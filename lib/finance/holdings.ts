import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import { parseMoneyInput } from "@/lib/money";
import { EARLIEST_VALUE_DAY, HOLDING_KINDS, MAX_HOLDING_CENTS, MAX_HOLDING_VALUES, MAX_HOLDINGS, type HoldingKind, type Point } from "./net-worth";

/**
 * Phase 34: things a jar owns or owes that the bank feed can't see (lib/finance/net-worth.ts),
 * read and written here. Every function takes a jarId the caller got from requireJar, and every
 * write is scoped by it, so a holding id from another jar matches nothing.
 */

type Db = Tx | typeof prisma;

// ---- the forms -----------------------------------------------------------------------------

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d: string) => DAY_TEXT.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const valueSchema = z.object({
  value: z.string().trim().min(1, "What's it worth?").max(20, "Use a dollar amount, like 350000."),
  valuedOn: z.string().trim().refine(realDay, "Pick the day it was worth that."),
});
const holdingSchema = valueSchema.extend({
  name: z.string().trim().min(1, "Give it a name.").max(60, "Keep the name to 60 letters."),
  kind: z.enum(HOLDING_KINDS, { message: "Pick what it is." }),
});

export type ValueInput = { valueCents: number; valuedOn: string };
export type HoldingInput = ValueInput & { name: string; kind: HoldingKind };

const raw = (formData: FormData, k: string) => {
  const v = formData.get(k);
  return typeof v === "string" ? v : undefined;
};

function checkValue(value: string, valuedOn: string, today: string): { ok: true; v: ValueInput } | { ok: false; error: string } {
  const money = parseMoneyInput(value, { max: MAX_HOLDING_CENTS });
  if (!money.ok) return { ok: false, error: money.error === "That amount is too large" ? "That's more than $20 million. Check the amount." : "Use a dollar amount, like 350000." };
  // 0 is a real answer: a loan paid off, a car that's worth nothing now.
  if (money.cents == null) return { ok: false, error: "What's it worth?" };
  if (valuedOn > today) return { ok: false, error: "Pick today or a day that's passed." };
  if (valuedOn < EARLIEST_VALUE_DAY) return { ok: false, error: "Pick a day after 1950." };
  return { ok: true, v: { valueCents: money.cents, valuedOn } };
}

/** "+ Add something": name, kind, value and the day it was worth that (today by default). */
export function parseHoldingForm(formData: FormData, today: string): { ok: true; holding: HoldingInput } | { ok: false; error: string } {
  const parsed = holdingSchema.safeParse({ name: raw(formData, "name") ?? "", kind: raw(formData, "kind") ?? "", value: raw(formData, "value") ?? "", valuedOn: raw(formData, "valuedOn") ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const checked = checkValue(parsed.data.value, parsed.data.valuedOn, today);
  if (!checked.ok) return checked;
  return { ok: true, holding: { name: parsed.data.name, kind: parsed.data.kind, ...checked.v } };
}

/** "Update the value": a new value on a day (the same day replaces that day's value). */
export function parseValueForm(formData: FormData, today: string): { ok: true; value: ValueInput } | { ok: false; error: string } {
  const parsed = valueSchema.safeParse({ value: raw(formData, "value") ?? "", valuedOn: raw(formData, "valuedOn") ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the value." };
  const checked = checkValue(parsed.data.value, parsed.data.valuedOn, today);
  return checked.ok ? { ok: true, value: checked.v } : checked;
}

// ---- the database --------------------------------------------------------------------------

const asDate = (civil: string) => new Date(`${civil}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export type HoldingRow = { id: string; name: string; kind: HoldingKind; values: Point[] };

/** A jar's holdings, each with its values oldest first. */
export async function readHoldings(db: Db, jarId: string): Promise<HoldingRow[]> {
  const rows = await db.finHolding.findMany({
    where: { jarId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, kind: true, values: { orderBy: { valuedOn: "asc" }, select: { valuedOn: true, valueCents: true } } },
  });
  return rows.map((h) => ({ id: h.id, name: h.name, kind: h.kind, values: h.values.map((v) => ({ day: dayOf(v.valuedOn), cents: v.valueCents })) }));
}

/** Each account's balance days on or after `from` (plus the one before, so `from`'s month-end has a value), oldest first. */
export async function readBalanceDays(db: Db, accountIds: string[], from: string): Promise<Map<string, Point[]>> {
  const out = new Map<string, Point[]>(accountIds.map((id) => [id, []]));
  if (!accountIds.length) return out;
  const [rows, before] = await Promise.all([
    db.finBalanceDay.findMany({
      where: { accountId: { in: accountIds }, day: { gte: asDate(from) } },
      orderBy: [{ accountId: "asc" }, { day: "asc" }],
      select: { accountId: true, day: true, balanceCents: true },
    }),
    // Only the newest older row per account, not years of them.
    db.$queryRaw<{ accountId: string; day: Date; balanceCents: number }[]>`
      SELECT DISTINCT ON ("accountId") "accountId", "day", "balanceCents"
      FROM "fin_balance_day"
      WHERE "accountId" = ANY(${accountIds}::text[]) AND "day" < ${asDate(from)}::date
      ORDER BY "accountId", "day" DESC`,
  ]);
  for (const r of [...before, ...rows]) out.get(r.accountId)!.push({ day: dayOf(r.day), cents: r.balanceCents });
  return out;
}

export type WriteResult = { ok: true; name: string; kind: HoldingKind } | { ok: false; error: string };
const GONE = { ok: false, error: "That isn't here anymore." } as const;

/**
 * One write at a time: the counts checked after this (the caps, "the last value stays") can't be
 * raced past by a double tap or two members at once. A jar's holdings for adding; one holding
 * (if it's this jar's) for its values.
 */
async function lockJarHoldings(tx: Tx, jarId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"fin_holding:" + jarId}))`;
}
async function lockHolding(tx: Tx, jarId: string, holdingId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "fin_holding" WHERE "id" = ${holdingId} AND "jarId" = ${jarId} FOR UPDATE`;
  return rows.length > 0;
}

export async function addHolding(jarId: string, h: HoldingInput): Promise<WriteResult> {
  return prisma.$transaction(async (tx) => {
    await lockJarHoldings(tx, jarId);
    if ((await tx.finHolding.count({ where: { jarId } })) >= MAX_HOLDINGS) return { ok: false, error: "That's a lot already. Remove one you don't need first." };
    await tx.finHolding.create({ data: { jarId, name: h.name, kind: h.kind, values: { create: { valuedOn: asDate(h.valuedOn), valueCents: h.valueCents } } } });
    return { ok: true, name: h.name, kind: h.kind };
  });
}

/** A new value on a day, or that day's value replaced. */
export async function setHoldingValue(jarId: string, holdingId: string, v: ValueInput): Promise<WriteResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockHolding(tx, jarId, holdingId))) return GONE;
    const holding = await tx.finHolding.findFirst({ where: { id: holdingId, jarId }, select: { id: true, name: true, kind: true, _count: { select: { values: true } } } });
    if (!holding) return GONE;
    const key = { holdingId_valuedOn: { holdingId: holding.id, valuedOn: asDate(v.valuedOn) } };
    const exists = await tx.finHoldingValue.findUnique({ where: key, select: { holdingId: true } });
    if (!exists && holding._count.values >= MAX_HOLDING_VALUES) return { ok: false, error: "That's a lot of values. Take off an old one first." };
    await tx.finHoldingValue.upsert({ where: key, create: { holdingId: holding.id, valuedOn: asDate(v.valuedOn), valueCents: v.valueCents }, update: { valueCents: v.valueCents } });
    return { ok: true, name: holding.name, kind: holding.kind };
  });
}

/** Takes one value off (a typo on an old day). The last one stays: remove the whole thing instead. */
export async function removeHoldingValue(jarId: string, holdingId: string, valuedOn: string): Promise<WriteResult> {
  if (!realDay(valuedOn)) return GONE;
  return prisma.$transaction(async (tx) => {
    if (!(await lockHolding(tx, jarId, holdingId))) return GONE;
    const holding = await tx.finHolding.findFirst({ where: { id: holdingId, jarId }, select: { id: true, name: true, kind: true, _count: { select: { values: true } } } });
    if (!holding) return GONE;
    if (holding._count.values <= 1) return { ok: false, error: "That's its only value. Remove the whole thing instead." };
    const { count } = await tx.finHoldingValue.deleteMany({ where: { holdingId: holding.id, valuedOn: asDate(valuedOn) } });
    return count ? { ok: true, name: holding.name, kind: holding.kind } : GONE;
  });
}

export async function removeHolding(jarId: string, holdingId: string): Promise<WriteResult> {
  const holding = await prisma.finHolding.findFirst({ where: { id: holdingId, jarId }, select: { id: true, name: true, kind: true } });
  if (!holding) return GONE;
  const { count } = await prisma.finHolding.deleteMany({ where: { id: holding.id, jarId } });
  return count ? { ok: true, name: holding.name, kind: holding.kind } : GONE;
}
