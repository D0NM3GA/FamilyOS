import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { parseOfx, type ImportedRow } from "./importers";
import { importRows } from "./sync";
import {
  applyChoices,
  checkChoices,
  decodeStatement,
  guessChoices,
  householdDateOrder,
  layoutKey,
  readSheet,
  type Choices,
  type Sheet,
} from "./statement-columns";

/**
 * Phase 52: a statement file, checked then imported (docs/PLAN.md, Phase 52). OFX and QFX import
 * straight away, as before. A CSV is read, its columns guessed (or taken from what this account's
 * last file with the same layout used), and shown on a few rows; the import uses the choices the
 * person confirmed, remembers them for the account, and records the import so it can be removed.
 */

export type CsvCheck = {
  kind: "csv";
  /** Each column's name in the file, or "Column 3" when it has no header. */
  columns: string[];
  choices: Choices;
  suggestFlip: boolean;
  dateOrderFrom: "file" | "setting" | "remembered" | "chosen";
  preview: { day: string; description: string; amount: string; direction: "in" | "out" }[];
  willAdd: number;
  skipped: number;
};

export type StatementCheck = { kind: "ofx"; rows: number } | CsvCheck | { kind: "error"; error: string };

const isOfx = (text: string) => /<OFX>|OFXHEADER|<STMTTRN>/i.test(text);

function columnNames(sheet: Sheet): string[] {
  return Array.from({ length: sheet.columns }, (_, i) => sheet.header?.[i]?.trim() || `Column ${i + 1}`);
}

async function fallbackOrder(householdId: string) {
  const h = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { statementDateOrder: true, timezone: true } });
  return householdDateOrder(h.statementDateOrder, h.timezone);
}

async function rememberedFor(accountId: string | null, key: string): Promise<unknown> {
  if (!accountId) return null;
  const account = await prisma.finAccount.findUnique({ where: { id: accountId }, select: { importLayouts: true } });
  const layouts = account?.importLayouts;
  return layouts && typeof layouts === "object" && !Array.isArray(layouts) ? (layouts as Record<string, unknown>)[key] ?? null : null;
}

/**
 * What the app understood: the guess, or this account's remembered choices for the layout, or the
 * person's own choices when they changed one (`chosen`). The first rows as they'd be saved.
 */
export async function checkStatement(householdId: string, accountId: string | null, bytes: Uint8Array, chosen?: unknown): Promise<StatementCheck> {
  const text = decodeStatement(bytes);
  if (isOfx(text)) {
    const parsed = parseOfx(text);
    return parsed.ok ? { kind: "ofx", rows: parsed.rows.length } : { kind: "error", error: parsed.error };
  }
  const sheet = readSheet(text);
  if (sheet.rows.length === 0 || sheet.columns < 2) return { kind: "error", error: "That file has no rows the app can read." };
  const guess = guessChoices(sheet, await fallbackOrder(householdId));
  const fromPerson = chosen ? checkChoices(chosen, sheet) : null;
  const fromMemory = !fromPerson ? checkChoices(await rememberedFor(accountId, layoutKey(sheet)), sheet) : null;
  const choices = fromPerson ?? fromMemory ?? guess.choices;
  const { rows, skipped } = applyChoices(sheet, choices);
  return {
    kind: "csv",
    columns: columnNames(sheet),
    choices,
    suggestFlip: guess.suggestFlip && !choices.flip,
    dateOrderFrom: fromPerson ? "chosen" : fromMemory ? "remembered" : guess.dateOrderFrom,
    preview: rows.slice(0, 5).map((r) => ({
      day: r.postedOn,
      description: r.description,
      amount: formatMoney(Math.abs(r.amountCents)),
      direction: r.amountCents < 0 ? "out" : "in",
    })),
    willAdd: rows.length,
    skipped,
  };
}

export type ImportOutcome = { ok: true; added: number; already: number; skipped: number } | { ok: false; error: string };

/**
 * Imports the file into the account. A CSV needs the confirmed choices; they're remembered for
 * this account's layout. Each import is recorded (FinImport) when it adds anything.
 */
export async function importStatementFile(
  jar: { id: string },
  accountId: string,
  personId: string,
  bytes: Uint8Array,
  chosen: unknown,
): Promise<ImportOutcome> {
  const text = decodeStatement(bytes);
  let rows: ImportedRow[];
  let skipped: number;
  let format: string;
  if (isOfx(text)) {
    const parsed = parseOfx(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    [rows, skipped, format] = [parsed.rows, parsed.skipped, "ofx"];
  } else {
    const sheet = readSheet(text);
    const choices = checkChoices(chosen, sheet);
    if (!choices) return { ok: false, error: "Check the file first, then import." };
    ({ rows, skipped } = applyChoices(sheet, choices));
    format = "csv";
    if (!rows.length) return { ok: false, error: "With those choices no row reads. Check the columns and try again." };
    const account = await prisma.finAccount.findUniqueOrThrow({ where: { id: accountId }, select: { importLayouts: true } });
    const layouts = account.importLayouts && typeof account.importLayouts === "object" && !Array.isArray(account.importLayouts) ? (account.importLayouts as Record<string, unknown>) : {};
    await prisma.finAccount.update({ where: { id: accountId }, data: { importLayouts: { ...layouts, [layoutKey(sheet)]: choices } as Prisma.InputJsonObject } });
  }
  const record = await prisma.finImport.create({ data: { jarId: jar.id, accountId, byPersonId: personId, format, added: 0 }, select: { id: true } });
  const { added, already } = await importRows(jar.id, accountId, rows, { importId: record.id });
  if (added === 0) await prisma.finImport.delete({ where: { id: record.id } });
  else await prisma.finImport.update({ where: { id: record.id }, data: { added } });
  return { ok: true, added, already, skipped };
}

/** Recent imports for the jar's Statement section (the last 10). */
export function recentImports(jarId: string) {
  return prisma.finImport.findMany({
    where: { jarId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, added: true, format: true, account: { select: { name: true } }, by: { select: { firstName: true } } },
  });
}

/** Removes every row one import brought, then the record. Returns how many rows went. */
export async function removeImport(jarId: string, importId: string): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const record = await tx.finImport.findFirst({ where: { id: importId, jarId }, select: { id: true } });
    if (!record) return null;
    const { count } = await tx.finTransaction.deleteMany({ where: { jarId, importId: record.id, source: "MANUAL" } });
    await tx.finImport.delete({ where: { id: record.id } });
    return count;
  });
}
