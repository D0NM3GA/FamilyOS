import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import { parseMoneyInput } from "@/lib/money";
import { merchantKeyOf } from "./categories";
import { addMonths, comingUp, daysBetween, LATE_DAYS, type PaidCheck, type Recurring } from "./recurring";

/**
 * Bills added by hand (ManualBill): school fees, the yearly car registration, rent paid by
 * check. Finding bills from charges (lib/finance/recurring.ts) can't see a bill that's paid
 * by check, or that comes once a year when the bank feed reaches back three months.
 *
 * They're counted the way found bills are: one line in Coming up from a few days late through
 * the next 30 days, and one planned payment in Safe to spend (lib/finance/forecast.ts), taken
 * off a late one when a charge of about its size has already left. A hand-added bill has no
 * account, so Safe to spend takes it as leaving checking (where checks and school payments
 * come from); like everything there, that errs low.
 *
 * Never twice: a hand-added bill stands for the found bill whose merchant key is its
 * `matchKey` (picked on the form, else its own name's key, so "Netflix" typed by hand stands
 * for the Netflix found from charges, even one found later). That found bill is left out of
 * Coming up and Safe to spend, and its charges count as paying the hand-added one.
 */

type Db = Tx | typeof prisma;

export const BILL_CADENCES = ["MONTHLY", "QUARTERLY", "YEARLY", "ONCE"] as const;
export type BillCadence = (typeof BILL_CADENCES)[number];

export const CADENCE_LABEL: Record<BillCadence, string> = {
  MONTHLY: "every month",
  QUARTERLY: "every 3 months",
  YEARLY: "every year",
  ONCE: "just once",
};

export type ManualBillInput = {
  id: string;
  name: string;
  /** Money out, positive. */
  amountCents: number;
  cadence: BillCadence;
  /** The first due day (a civil day); later ones follow by cadence. */
  nextDue: string;
  matchKey: string;
};

const STEP_MONTHS: Record<BillCadence, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12, ONCE: 0 };
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/** How far ahead a bill's next due day is looked for: a yearly one is at most a year off. */
const HORIZON_DAYS = 5 * 366;

/** The bill's due days from `from` through `until` (civil days, both inclusive), oldest first. */
export function dueDays(bill: Pick<ManualBillInput, "cadence" | "nextDue">, from: string, until: string): string[] {
  const step = STEP_MONTHS[bill.cadence];
  if (!step) return bill.nextDue >= from && bill.nextDue <= until ? [bill.nextDue] : [];
  const out: string[] = [];
  // Each due day is counted from the first one, so a bill on the 31st comes back on the 31st
  // after February's 28th. Starts a step before `from`'s month instead of walking from a first
  // day years back.
  for (let k = Math.max(0, Math.floor((monthIndex(from) - monthIndex(bill.nextDue)) / step) - 1); ; k++) {
    const d = addMonths(bill.nextDue, k * step);
    if (d > until) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/**
 * The next due day still to pay: the first from a few days ago on, skipping one on or before
 * today that `paid` says was paid already. Null for a one-off bill that's been and gone.
 */
export function nextDueOn(bill: Pick<ManualBillInput, "cadence" | "nextDue">, today: string, paid: (due: string) => boolean = () => false): string | null {
  for (const d of dueDays(bill, addDays(today, -LATE_DAYS), addDays(today, HORIZON_DAYS))) {
    if (d <= today && paid(d)) continue;
    return d;
  }
  return null;
}

/** The found bills (their keys) one hand-added bill stands for. */
export function ownKeys(bill: Pick<ManualBillInput, "matchKey">, found: Pick<Recurring, "key" | "merchantKey">[]): string[] {
  if (!bill.matchKey) return [];
  return [bill.matchKey, ...found.filter((r) => r.key === bill.matchKey || r.merchantKey === bill.matchKey).map((r) => r.key)];
}

/** Found bills some hand-added bill stands for: they're left out, so nothing is counted twice. */
export function standsFor(manual: Pick<ManualBillInput, "matchKey">[], found: Pick<Recurring, "key" | "merchantKey">[]): Set<string> {
  return new Set(manual.flatMap((b) => ownKeys(b, found)));
}

export type AheadItem = {
  key: string;
  label: string;
  nextOn: string;
  typicalCents: number;
  steady: boolean;
  cardMemo: string | null;
  cancelling: boolean;
  /** Added by hand (✍️): the ManualBill's id. */
  manualId: string | null;
};

/**
 * Coming up with the hand-added bills in: the found bills (recurring.ts comingUp) minus those a
 * hand-added bill stands for, plus each hand-added bill's next due day in the same window, one
 * line per bill, with about how much they add up to.
 */
export function billsAhead(
  found: Recurring[],
  manual: ManualBillInput[],
  statusOf: Map<string, string>,
  today: string,
  days = 30,
  paid: PaidCheck = () => false,
): { items: AheadItem[]; totalCents: number } {
  const replaced = standsFor(manual, found);
  const items: AheadItem[] = comingUp(
    found.filter((r) => !replaced.has(r.key)),
    statusOf,
    today,
    days,
  ).items.map((r) => ({ key: r.key, label: r.label, nextOn: r.nextOn!, typicalCents: r.typicalCents, steady: r.steady, cardMemo: r.cardMemo, cancelling: r.cancelling, manualId: null }));
  for (const b of manual) {
    const own = ownKeys(b, found);
    const next = nextDueOn(b, today, (due) => paid(own, due, b.amountCents, true));
    if (next && daysBetween(today, next) <= days) {
      items.push({ key: `manual:${b.id}`, label: b.name, nextOn: next, typicalCents: b.amountCents, steady: true, cardMemo: null, cancelling: false, manualId: b.id });
    }
  }
  items.sort((a, b) => a.nextOn.localeCompare(b.nextOn) || a.label.localeCompare(b.label));
  return { items, totalCents: items.reduce((n, i) => n + i.typicalCents, 0) };
}

/** The merchant key a bill's own name stands for ("Netflix" → "netflix"). */
export const nameKey = (name: string) => merchantKeyOf({ description: name });

// ---- the form ------------------------------------------------------------------------------

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d: string) => DAY_TEXT.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const formSchema = z.object({
  name: z.string().trim().min(1, "Give the bill a name.").max(60, "Keep the name to 60 letters."),
  amount: z.string().trim().min(1, "How much is it?").max(20, "Use a dollar amount, like 120 or 120.50."),
  cadence: z.enum(BILL_CADENCES, { message: "Pick how often it comes." }),
  nextDue: z.string().trim().refine(realDay, "Pick the day it's due."),
  // A found bill's merchant key, from the form's list. Anything else just won't match one.
  matchKey: z.string().trim().max(160).default(""),
});

export type ManualBillForm = Omit<ManualBillInput, "id">;

/**
 * The "+ Add a bill" / edit form. The due day can be up to a year back (a monthly bill's first
 * day; later ones follow) and five years ahead; a one-off bill's day must not have passed.
 * With no found bill picked, the bill stands for whatever its own name's key matches.
 */
export function parseManualBillForm(
  formData: FormData,
  today: string,
  /** Editing: the bill's stored due day, which may stay even if it's long past (a one-off that's done). */
  opts: { keepDay?: string } = {},
): { ok: true; bill: ManualBillForm } | { ok: false; error: string } {
  const raw = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const parsed = formSchema.safeParse({ name: raw("name"), amount: raw("amount") ?? "", cadence: raw("cadence"), nextDue: raw("nextDue") ?? "", matchKey: raw("matchKey") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the bill's details." };
  const { name, amount, cadence, nextDue, matchKey } = parsed.data;
  const money = parseMoneyInput(amount);
  if (!money.ok) return { ok: false, error: "Use a dollar amount, like 120 or 120.50." };
  if (!money.cents) return { ok: false, error: "How much is it?" };
  const unchanged = opts.keepDay === nextDue;
  if (!unchanged && nextDue < addDays(today, -366)) return { ok: false, error: "Pick a due day within the last year, or the next one." };
  if (nextDue > addDays(today, 5 * 365)) return { ok: false, error: "Pick a due day within five years." };
  if (!unchanged && cadence === "ONCE" && nextDue < addDays(today, -LATE_DAYS)) return { ok: false, error: "That day has passed. Pick when it's due." };
  return { ok: true, bill: { name, amountCents: money.cents, cadence, nextDue, matchKey: matchKey || nameKey(name) } };
}

/**
 * The due day to store when a bill is edited. The form shows the next occurrence, not the
 * stored first one, so a bill on the 31st shows Feb 28 in February; saving that as the new
 * first day would move every later month to the 28th. While the cadence is the same and the
 * day is already on the bill's schedule, the stored day stays.
 */
export function anchorForEdit(stored: Pick<ManualBillInput, "cadence" | "nextDue">, edited: Pick<ManualBillInput, "cadence" | "nextDue">): string {
  return stored.cadence === edited.cadence && dueDays(stored, edited.nextDue, edited.nextDue).length > 0 ? stored.nextDue : edited.nextDue;
}

// ---- the database --------------------------------------------------------------------------

/** Most hand-added bills one jar can have: plenty for a family, and a cap on a runaway form. */
export const MAX_MANUAL_BILLS = 100;

/** A jar's hand-added bills, as the functions above take them. Callers have passed requireJar. */
export async function readManualBills(db: Db, jarId: string): Promise<(ManualBillInput & { createdBy: string | null })[]> {
  const rows = await db.manualBill.findMany({
    where: { jarId },
    orderBy: [{ nextDue: "asc" }, { name: "asc" }],
    select: { id: true, name: true, amountCents: true, cadence: true, nextDue: true, matchKey: true, createdBy: { select: { firstName: true } } },
  });
  return rows.map((r) => ({ ...r, nextDue: r.nextDue.toISOString().slice(0, 10), createdBy: r.createdBy?.firstName ?? null }));
}
