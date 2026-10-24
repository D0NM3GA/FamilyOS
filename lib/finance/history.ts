import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import type { JarEventKind } from "@/app/generated/prisma/enums";
import { prisma, type Tx } from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { formatMoney } from "@/lib/money";
import { hiddenFromWhere, visibleToWhere } from "./gifts";
import { BILL_CADENCES, CADENCE_LABEL, type BillCadence } from "./manual-bills";
import { HOLDING_KIND, HOLDING_KINDS, isOwed, type HoldingKind } from "./net-worth";

/**
 * Phase 30: who changed what in a jar. The two parents share a jar, so each can see what the
 * other did ("Mom set Dining's budget to $400"). Person actions only (the automatic tidy-ups
 * aren't events). Logging never fails the action it describes.
 *
 * Surprises: an event about a charge that's a surprise for the viewer, or about a merchant
 * one of those charges is from (a Bills answer, an "always" rule), is left out for them, the
 * same way the charge itself is.
 */

type Db = Tx | typeof prisma;

const name = z.string().max(60);
const label = z.string().max(60);
const key = z.string().max(160);
const emoji = z.string().max(32);

export const EVENT_DATA = {
  RENAMED: z.object({ name }),
  MEMBER_ADDED: z.object({ name }),
  MEMBER_REMOVED: z.object({ name, left: z.boolean() }),
  CONNECTED: z.object({ provider: z.enum(["SIMPLEFIN", "PRIVACY"]) }),
  DISCONNECTED: z.object({ provider: z.enum(["SIMPLEFIN", "PRIVACY"]) }),
  IMPORTED: z.object({ count: z.number().int().nonnegative(), account: name }),
  IMPORT_REMOVED: z.object({ count: z.number().int().nonnegative() }),
  CATEGORY_SET: z.object({ category: label.nullable(), always: z.boolean(), key, label }),
  RULE_FORGOTTEN: z.object({ key, label }),
  BUDGET_SET: z.object({ category: label, cents: z.number().int().nullable() }),
  BILL_ANSWERED: z.object({ key, label, status: z.enum(["KEEP", "CANCEL", "HIDDEN", "CLEAR"]) }),
  TRIP_LINKED: z.object({}),
  TRIP_UNLINKED: z.object({}),
  ORDER_LINKED: z.object({ retailer: label }),
  ORDER_UNLINKED: z.object({ retailer: label }),
  SURPRISE_MARKED: z.object({ for: z.array(name).max(10), until: z.string().max(10) }),
  SURPRISE_REVEALED: z.object({}),
  CHAT_SET: z.object({ on: z.boolean() }),
  ROLLOVER_SET: z.object({ category: label, on: z.boolean() }),
  ACCOUNTS_SET: z.object({ count: z.number().int().nonnegative() }),
  ACCOUNT_LEFT_OUT: z.object({ name, out: z.boolean() }),
  CUSHION_SET: z.object({ cents: z.number().int().nullable() }),
  GOAL_SET: z.object({ category: label, cents: z.number().int().nullable(), month: z.string().regex(/^\d{4}-\d{2}$/).nullable() }),
  // Bills added by hand (lib/finance/manual-bills.ts): never a surprise, so no merchant key here.
  BILL_ADDED: z.object({ name, cents: z.number().int().positive(), cadence: z.enum(BILL_CADENCES) }),
  BILL_CHANGED: z.object({ name }),
  BILL_REMOVED: z.object({ name }),
  // A spreadsheet of the jar's activity: one month, or everything (null).
  EXPORTED: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).nullable(), count: z.number().int().nonnegative() }),
  // Phase 34: Net worth's hand-valued things (lib/finance/holdings.ts), never a surprise. A
  // value of null: that day's value was taken off.
  HOLDING_ADDED: z.object({ name, kind: z.enum(HOLDING_KINDS) }),
  HOLDING_VALUED: z.object({ name, kind: z.enum(HOLDING_KINDS), cents: z.number().int().nonnegative().nullable(), on: z.iso.date() }),
  HOLDING_REMOVED: z.object({ name }),
  // Phase 37: the jar's own categories (lib/finance/category-edits.ts), named as they were at
  // the time. A rename with the same name changed only the emoji. A removal has no count of the
  // charges moved: everyone reads the line, and a count that includes a surprise hidden from
  // one of them would give it away.
  CATEGORY_ADDED: z.object({ name, emoji: emoji.nullable(), kind: z.enum(["SPEND", "INCOME"]) }),
  CATEGORY_RENAMED: z.object({ from: name, to: name, emoji: emoji.nullable() }),
  CATEGORY_REMOVED: z.object({ name, to: name }),
} satisfies Record<JarEventKind, z.ZodType>;

type EventData<K extends JarEventKind> = z.infer<(typeof EVENT_DATA)[K]>;

/** "an Amazon order", "a Publix order". */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** "netflix" → "Netflix", "blue bottle coffee" → "Blue Bottle Coffee"; never the raw bank text. */
export function merchantLabel(merchantKey: string | null | undefined): string {
  const k = merchantKey && merchantKey !== "-" ? merchantKey : "";
  if (k.startsWith("privacy:")) return "a Privacy.com card";
  return k ? k.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 60) : "a merchant";
}

/** Records one event. Never throws: a failed log is reported (ids only) and the action goes on. */
export async function logJarEvent<K extends JarEventKind>(
  db: Db,
  e: { jarId: string; actorId: string; kind: K; data: EventData<K>; txnId?: string | null },
): Promise<void> {
  try {
    await db.jarEvent.create({
      data: { jarId: e.jarId, actorId: e.actorId, kind: e.kind, data: EVENT_DATA[e.kind].parse(e.data) as Prisma.InputJsonValue, txnId: e.txnId ?? null },
    });
  } catch (err) {
    captureError(new Error(`jar history write failed (jar ${e.jarId}, ${e.kind}): ${err instanceof Error ? err.constructor.name : "unknown"}`));
  }
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** One event as a sentence. Unreadable data reads as a vague sentence, never raw JSON. */
export function describeEvent(kind: JarEventKind, raw: unknown, actor: string): string {
  const parsed = EVENT_DATA[kind].safeParse(raw);
  if (!parsed.success) return `${actor} changed something`;
  const d = parsed.data as Record<string, unknown>;
  switch (kind) {
    case "RENAMED":
      return `${actor} renamed the jar to ${d.name}`;
    case "MEMBER_ADDED":
      return `${actor} added ${d.name}`;
    case "MEMBER_REMOVED":
      return d.left ? `${actor} left the jar` : `${actor} removed ${d.name}`;
    case "CONNECTED":
      return `${actor} connected ${d.provider === "PRIVACY" ? "Privacy.com" : "the bank feed"}`;
    case "DISCONNECTED":
      return `${actor} disconnected ${d.provider === "PRIVACY" ? "Privacy.com" : "the bank feed"}`;
    case "IMPORTED":
      return `${actor} imported ${d.count} transaction${d.count === 1 ? "" : "s"} into ${d.account}`;
    case "IMPORT_REMOVED":
      return `${actor} removed an import (${d.count} transaction${d.count === 1 ? "" : "s"})`;
    case "CATEGORY_SET":
      return d.always
        ? `${actor} set ${d.label} to always be ${d.category ?? "uncategorized"}`
        : `${actor} put a ${d.label} charge in ${d.category ?? "no category"}`;
    case "RULE_FORGOTTEN":
      return `${actor} stopped the "always" rule for ${d.label}`;
    case "BUDGET_SET":
      return d.cents == null ? `${actor} took the budget off ${d.category}` : `${actor} set ${d.category}'s budget to ${formatMoney(d.cents as number)}`;
    case "BILL_ANSWERED":
      return {
        KEEP: `${actor} is still using ${d.label}`,
        CANCEL: `${actor} wants to cancel ${d.label}`,
        HIDDEN: `${actor} said ${d.label} isn't a bill`,
        CLEAR: `${actor} undid the answer for ${d.label}`,
      }[d.status as "KEEP" | "CANCEL" | "HIDDEN" | "CLEAR"];
    case "TRIP_LINKED":
      return `${actor} linked a grocery trip to a charge`;
    case "TRIP_UNLINKED":
      return `${actor} said a charge wasn't that grocery trip`;
    case "ORDER_LINKED":
      return `${actor} linked ${article(d.retailer as string)} ${d.retailer} order to a charge`;
    case "ORDER_UNLINKED":
      return `${actor} took ${article(d.retailer as string)} ${d.retailer} order off a charge`;
    case "SURPRISE_MARKED":
      return `${actor} marked a charge 🎁 for ${(d.for as string[]).join(", ") || "someone"} until ${day(d.until as string)}`;
    case "SURPRISE_REVEALED":
      return `${actor} showed a surprise early`;
    case "CHAT_SET":
      return d.on ? `${actor} sent the jar's alerts to a Teams chat` : `${actor} stopped the jar's Teams chat alerts`;
    case "ROLLOVER_SET":
      return d.on ? `${actor} started saving up leftovers in ${d.category}` : `${actor} stopped rolling over ${d.category}`;
    case "ACCOUNTS_SET":
      return d.count === 0
        ? `${actor} cleared the spending accounts`
        : `${actor} picked ${d.count} spending account${d.count === 1 ? "" : "s"} for Safe to spend`;
    case "ACCOUNT_LEFT_OUT":
      return d.out ? `${actor} left ${d.name} out of the jar` : `${actor} brought ${d.name} back into the jar`;
    case "CUSHION_SET":
      return d.cents == null ? `${actor} took the cushion off` : `${actor} set the cushion to ${formatMoney(d.cents as number)}`;
    case "GOAL_SET":
      return d.cents == null
        ? `${actor} took the goal off ${d.category}`
        : `${actor} set a goal for ${d.category}: ${formatMoney(d.cents as number)} by ${monthName(d.month as string)}`;
    case "BILL_ADDED":
      return `${actor} added a bill by hand: ${d.name}, ${formatMoney(d.cents as number)} ${CADENCE_LABEL[d.cadence as BillCadence]}`;
    case "BILL_CHANGED":
      return `${actor} changed the bill ${d.name}`;
    case "BILL_REMOVED":
      return `${actor} removed the bill ${d.name}`;
    case "EXPORTED":
      return d.month ? `${actor} downloaded ${monthName(d.month as string)}'s activity as a spreadsheet` : `${actor} downloaded all the activity as a spreadsheet`;
    case "HOLDING_ADDED":
      return `${actor} added ${HOLDING_KIND[d.kind as HoldingKind].emoji} ${d.name} to Net worth`;
    case "HOLDING_VALUED":
      return d.cents == null
        ? `${actor} took off ${d.name}'s value from ${day(d.on as string)}`
        : `${actor} set ${d.name} to ${formatMoney(d.cents as number)}${isOwed(d.kind as HoldingKind) ? " owed" : ""} as of ${day(d.on as string)}`;
    case "HOLDING_REMOVED":
      return `${actor} removed ${d.name} from Net worth`;
    case "CATEGORY_ADDED":
      return `${actor} added ${d.emoji ? `${d.emoji} ` : ""}${d.name}${d.kind === "INCOME" ? " for income" : ""}`;
    case "CATEGORY_RENAMED":
      if (d.from !== d.to) return `${actor} renamed ${d.from} to ${d.to}`;
      return d.emoji ? `${actor} changed ${d.to}'s emoji to ${d.emoji}` : `${actor} took the emoji off ${d.to}`;
    case "CATEGORY_REMOVED":
      return `${actor} removed ${d.name} (moved its charges to ${d.to})`;
  }
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export type HistoryLine = { id: string; at: Date; text: string };

/** The jar's recent history as this viewer may see it. */
export async function jarHistory(jarId: string, viewerId: string, today: string, take = 30): Promise<HistoryLine[]> {
  const hiddenRows = await prisma.finTransaction.findMany({
    where: { jarId, ...hiddenFromWhere(viewerId, today) },
    select: { merchantKey: true, privacyCharges: { select: { cardToken: true } } },
  });
  // A charge with no merchant ("" or "-") says nothing about other charges.
  const hiddenKeys = new Set(
    hiddenRows.flatMap((r) => [r.merchantKey, ...r.privacyCharges.flatMap((p) => (p.cardToken ? [`privacy:${p.cardToken}`] : []))]).filter((k) => k && k !== "-"),
  );
  const lines: HistoryLine[] = [];
  // Pages until there are enough lines the viewer may see (a few pages at most).
  for (let skip = 0, page = 0; lines.length < take && page < 5; page++) {
    const events = await prisma.jarEvent.findMany({
      // A nullable relation filter alone would drop every event without a charge.
      where: { jarId, OR: [{ txnId: null }, { txn: visibleToWhere(viewerId, today) }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: take * 2,
      select: { id: true, kind: true, data: true, createdAt: true, actor: { select: { firstName: true } } },
    });
    skip += events.length;
    for (const e of events) {
      const k = (e.data as { key?: unknown } | null)?.key;
      if (typeof k === "string" && hiddenKeys.has(k)) continue;
      if (lines.length < take) lines.push({ id: e.id, at: e.createdAt, text: describeEvent(e.kind, e.data, e.actor?.firstName ?? "Someone") });
    }
    if (events.length < take * 2) break;
  }
  return lines;
}
