import { createHash } from "node:crypto";
import { splitCsv, type ImportedRow } from "./importers";

/**
 * Phase 52: a bank or card CSV, worked out (docs/PLAN.md, Phase 52). Real exports differ in
 * nearly everything: account details before the header, no header at all, the column names, the
 * separator, the encoding, the date form, comma decimals, a Type column, and which way charges
 * go. So this reads the file, guesses which column is which (names first, contents second), and
 * the person checks the guess on a few rows before anything is saved. Pure: bytes in, rows out.
 */

/** Bumped when the guessing changes, so a remembered layout is checked again. */
export const READER_VERSION = 1;
const MAX_ROWS = 10_000;
const SAMPLE = 50;

export type DateOrder = "MONTH_FIRST" | "DAY_FIRST";

/** What the person confirms (or fixes) in the check step. Column numbers count from 0. */
export type Choices = {
  date: number;
  description: number;
  memo: number | null;
  /** One signed amount column, or a debit and a credit column. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** A debit/credit (or sale/payment) column that sets the sign of an all-positive amount. */
  type: number | null;
  dateOrder: DateOrder;
  decimalComma: boolean;
  /** Money out shows as positive in this file (some card exports): every amount is turned around. */
  flip: boolean;
};

export type Sheet = {
  separator: string;
  /** The file's own column names, or null when it has no header row. */
  header: string[] | null;
  rows: string[][];
  columns: number;
};

// ---------- reading the file ----------

/** UTF-8 (with or without its mark), else Windows-1252; UTF-16 when its byte-order mark says so. */
export function decodeStatement(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The separator that splits the first lines into the same number of fields most often. */
export function sniffSeparator(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 30).join("\n");
  let best = { sep: ",", score: 0 };
  for (const sep of [",", ";", "\t", "|"]) {
    const counts = splitCsv(head, sep).map((r) => r.length).filter((n) => n > 1);
    if (!counts.length) continue;
    const mode = [...counts.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1])[0];
    const score = mode[1] * Math.log2(mode[0] + 1);
    if (score > best.score) best = { sep, score };
  }
  return best.sep;
}

/**
 * Splits the file and finds where the rows start: the header is the first row followed by rows
 * that read as data, so account details above it are skipped; a first row that already reads as
 * data means there's no header.
 */
export function readSheet(text: string): Sheet {
  const separator = sniffSeparator(text);
  const all = splitCsv(text, separator).slice(0, MAX_ROWS + 30);
  const dataLike = (r: string[] | undefined) => Boolean(r && r.some((c) => dateOf(c, "MONTH_FIRST", true)) && r.some((c) => looksLikeMoney(c)));
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const row = all[i];
    if (row.length < 2) continue;
    const next = all.slice(i + 1, i + 4);
    if (dataLike(row) && next.every((r) => r.length === row.length)) {
      return { separator, header: null, rows: all.slice(i, i + MAX_ROWS), columns: row.length };
    }
    const words = row.filter((c) => /[a-z]/i.test(c) && !dateOf(c, "MONTH_FIRST", true) && !looksLikeMoney(c)).length;
    if (words >= 2 && next.length > 0 && next.every((r) => r.length >= row.length - 1 && r.length <= row.length + 1) && next.some(dataLike)) {
      return { separator, header: row.map((h) => h.trim()), rows: all.slice(i + 1, i + 1 + MAX_ROWS), columns: row.length };
    }
  }
  const first = all.find((r) => r.length >= 2) ?? [];
  return { separator, header: null, rows: all.filter((r) => r.length >= 2).slice(0, MAX_ROWS), columns: first.length };
}

/** The file's layout, for remembering choices: its header (or its column count), separator, reader version. */
export function layoutKey(sheet: Sheet): string {
  const shape = sheet.header ? sheet.header.map((h) => h.trim().toLowerCase()).join("\u0000") : `columns:${sheet.columns}`;
  return createHash("sha256").update(`v${READER_VERSION}|${sheet.separator}|${shape}`).digest("hex").slice(0, 24);
}

// ---------- cells ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function civil(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A cell as a civil day. `compact` also takes `20261003`, which a reference number can look like,
 * so it's only used where a date is expected.
 */
export function dateOf(raw: string, order: DateOrder, compact = false): string | null {
  const t = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) return civil(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [month, day] = order === "MONTH_FIRST" ? [+m[1], +m[2]] : [+m[2], +m[1]];
    return civil(year, month, day);
  }
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return civil(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  m = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s-](\d{4}|\d{2})$/i.exec(t);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return civil(year, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  }
  if (compact) {
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
    if (m) return civil(+m[1], +m[2], +m[3]);
  }
  return null;
}

/** What a numeric date's first two parts say about its order: day first, month first, or nothing. */
function orderHint(raw: string): DateOrder | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(raw.trim());
  if (!m) return null;
  if (+m[1] > 12 && +m[2] <= 12) return "DAY_FIRST";
  if (+m[2] > 12 && +m[1] <= 12) return "MONTH_FIRST";
  return null;
}

/** Money by its look: a decimal point or comma with cents, or a sign, `$`, parentheses or CR/DR. Bare digits aren't. */
export function looksLikeMoney(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 30) return false;
  return /^[(\-+−]?\s*[$€£]?\s*\(?[\d.,\s]*\d[.,]\d{2}\)?\s*(CR|DR)?$/i.test(t) || /^[-+−(][$€£]?\d[\d,]*\)?$/.test(t);
}

/** A cell as cents, with the file's decimal mark. */
export function centsOf(raw: string | undefined, decimalComma: boolean): number | null {
  if (raw == null) return null;
  let t = raw.trim().replace(/−/g, "-").replace(/[$€£\s]/g, "");
  if (!t) return null;
  let negative = false;
  const crdr = /^(.*?)(CR|DR)$/i.exec(t);
  if (crdr) {
    t = crdr[1];
    negative = crdr[2].toUpperCase() === "DR";
  }
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) {
    t = paren[1];
    negative = true;
  }
  if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  } else if (t.startsWith("+")) t = t.slice(1);
  t = decimalComma ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Words for a description: some letters, not a number or a date. */
const wordy = (c: string) => /[a-z]{2}/i.test(c) && !looksLikeMoney(c) && !dateOf(c, "MONTH_FIRST", true);

// ---------- guessing ----------

const HEADER = {
  date: /^(posted|post|posting|transaction|trans\.?|txn|value)?\s*date$|^date(\s+posted)?$/i,
  postDate: /post/i,
  description: /^(description|transaction description|payee|name|merchant|merchant name|details|narrative|particulars|transaction)$/i,
  memo: /^(memo|original description|extended details|notes?|additional (info|details)|reference description)$/i,
  amount: /^(amount|transaction amount|amount\s*\(.*\)|value|net amount)$/i,
  debit: /^(debit|debits|debit amount|withdrawals?|money out|paid out|charges?)$/i,
  credit: /^(credit|credits|credit amount|deposits?|money in|paid in|payments?\s*(and|&)?\s*credits?)$/i,
  type: /^(type|transaction type|debit\s*\/\s*credit|dr\s*\/\s*cr|cr\s*\/\s*dr|credit\s*\/\s*debit)$/i,
  never: /balance|^bal\.?$|running|ref|check|cheque|card|slip|number|^no\.?$|#|account/i,
};

const OUT_WORDS = /^(debit|dr|withdrawal|sale|purchase|fee|charge|payment sent|transfer out)$/i;
const IN_WORDS = /^(credit|cr|deposit|payment|return|refund|transfer in|interest)$/i;

export type Guess = {
  choices: Choices;
  /** Nearly every amount is positive: money out may show as positive (a card file). A suggestion only. */
  suggestFlip: boolean;
  /** Where the date order came from: the file's own dates, or the household's setting. */
  dateOrderFrom: "file" | "setting";
};

type Stats = { date: number; compactDate: number; money: number; words: number; distinct: number; filled: number };

function stats(rows: string[][], col: number): Stats {
  const cells = rows.map((r) => (r[col] ?? "").trim());
  const filled = cells.filter(Boolean);
  const n = Math.max(1, filled.length);
  return {
    date: filled.filter((c) => dateOf(c, "MONTH_FIRST") || dateOf(c, "DAY_FIRST")).length / n,
    compactDate: filled.filter((c) => dateOf(c, "MONTH_FIRST", true)).length / n,
    money: filled.filter(looksLikeMoney).length / n,
    words: filled.filter(wordy).length / n,
    distinct: new Set(filled.map((c) => c.toLowerCase())).size / n,
    filled: filled.length / Math.max(1, cells.length),
  };
}

/** A column whose steps match another money column's amounts: a running balance. */
function isRunningBalance(rows: string[][], col: number, amountCol: number, decimalComma: boolean): boolean {
  let checked = 0;
  let matched = 0;
  for (let i = 1; i < Math.min(rows.length, SAMPLE); i++) {
    const a = centsOf(rows[i - 1][col], decimalComma);
    const b = centsOf(rows[i][col], decimalComma);
    const amt = [centsOf(rows[i][amountCol], decimalComma), centsOf(rows[i - 1][amountCol], decimalComma)];
    if (a == null || b == null || amt[0] == null) continue;
    checked++;
    if (amt.some((x) => x != null && (b - a === x || a - b === x))) matched++;
  }
  return checked >= 3 && matched / checked > 0.7;
}

export function guessChoices(sheet: Sheet, fallbackOrder: DateOrder): Guess {
  const sample = sheet.rows.slice(0, SAMPLE);
  const cols = Array.from({ length: sheet.columns }, (_, i) => i);
  const name = (i: number) => sheet.header?.[i]?.trim() ?? "";
  const st = cols.map((i) => stats(sample, i));
  const named = (re: RegExp) => cols.filter((i) => re.test(name(i)) && !HEADER.never.test(name(i)));
  // A comma decimal (1.234,56 or 1,50) only when the file has those and no dot decimals.
  const cells = sample.flatMap((r) => r).map((c) => c.trim().replace(/[$€£\s]/g, ""));
  const commaDecimals = cells.filter((c) => /^[(\-+\u2212]?\d{1,3}(\.\d{3})*,\d{2}\)?$/.test(c)).length;
  const dotDecimals = cells.filter((c) => /^[(\-+\u2212]?\d{1,3}(,\d{3})*\.\d{2}\)?$|^[(\-+\u2212]?\d+\.\d{2}\)?$/.test(c)).length;
  const decimalComma = commaDecimals > 0 && dotDecimals === 0;
  const used = new Set<number>();

  // The date: by name (a posting date first), else the column that reads most as dates.
  const dateNamed = named(HEADER.date);
  let date = dateNamed.find((i) => HEADER.postDate.test(name(i))) ?? dateNamed[0];
  if (date == null) {
    const byContent = cols.filter((i) => st[i].date >= 0.8).sort((a, b) => st[b].date - st[a].date);
    date = byContent[0] ?? cols.filter((i) => st[i].compactDate >= 0.8)[0] ?? 0;
  }
  used.add(date);

  // The amount: one column by name, else a debit and credit pair by name, else by content.
  let amount: number | null = named(HEADER.amount).find((i) => !used.has(i)) ?? null;
  let debit: number | null = null;
  let credit: number | null = null;
  if (amount == null) {
    debit = named(HEADER.debit).find((i) => !used.has(i)) ?? null;
    credit = named(HEADER.credit).find((i) => !used.has(i) && i !== debit) ?? null;
    if (debit == null || credit == null) {
      debit = credit = null;
      const money = cols.filter((i) => !used.has(i) && !HEADER.never.test(name(i)) && st[i].money >= 0.6).sort((a, b) => st[b].money * st[b].filled - st[a].money * st[a].filled);
      const notBalance = money.filter((i) => !money.some((j) => j !== i && isRunningBalance(sample, i, j, decimalComma)));
      amount = notBalance[0] ?? money[0] ?? null;
      // Two half-filled money columns side by side: a debit and credit pair without names.
      if (amount != null && st[amount].filled < 0.9) {
        const partner = notBalance.find((i) => i !== amount && st[i].filled < 0.9 && Math.abs(st[i].filled + st[amount!].filled - 1) < 0.2);
        if (partner != null) {
          [debit, credit] = [Math.min(amount, partner), Math.max(amount, partner)];
          amount = null;
        }
      }
    }
  }
  for (const i of [amount, debit, credit]) if (i != null) used.add(i);

  // The description: by name, else the wordiest varied column (a category or status repeats).
  const description =
    named(HEADER.description).find((i) => !used.has(i)) ??
    cols.filter((i) => !used.has(i) && !HEADER.never.test(name(i)) && st[i].words >= 0.6 && st[i].distinct >= 0.3).sort((a, b) => st[b].words * st[b].distinct - st[a].words * st[a].distinct)[0] ??
    cols.find((i) => !used.has(i)) ??
    0;
  used.add(description);
  const memo = named(HEADER.memo).find((i) => !used.has(i)) ?? null;
  if (memo != null) used.add(memo);
  const type = named(HEADER.type).find((i) => !used.has(i)) ?? null;

  // The date order: the file's own dates decide; when every one could be either, the setting.
  const hints = sample.map((r) => orderHint(r[date] ?? "")).filter((h): h is DateOrder => h != null);
  const dateOrder = hints[0] ?? fallbackOrder;

  const choices: Choices = { date, description, memo, amount, debit, credit, type, dateOrder, decimalComma, flip: false };
  let suggestFlip = false;
  if (amount != null && type == null) {
    const values = sample.map((r) => centsOf(r[amount], decimalComma)).filter((c): c is number => c != null && c !== 0);
    const positive = values.filter((c) => c > 0).length;
    suggestFlip = values.length >= 5 && positive / values.length >= 0.85 && positive < values.length;
  }
  return { choices, suggestFlip, dateOrderFrom: hints.length ? "file" : "setting" };
}

// ---------- applying ----------

/** The rows as they'd be saved with these choices; `skipped` counts rows that don't read. */
export function applyChoices(sheet: Sheet, c: Choices): { rows: ImportedRow[]; skipped: number } {
  const seen = new Map<string, number>();
  const rows: ImportedRow[] = [];
  let skipped = 0;
  const typeSigns = c.type != null && c.amount != null && sheet.rows.every((r) => (centsOf(r[c.amount!], c.decimalComma) ?? 0) >= 0);
  for (const cells of sheet.rows) {
    const day = dateOf(cells[c.date] ?? "", c.dateOrder, true);
    let cents: number | null;
    if (c.amount != null) {
      cents = centsOf(cells[c.amount], c.decimalComma);
      if (cents != null && typeSigns) {
        const word = (cells[c.type!] ?? "").trim();
        if (OUT_WORDS.test(word)) cents = -Math.abs(cents);
        else if (IN_WORDS.test(word)) cents = Math.abs(cents);
      }
    } else {
      const d = centsOf(cells[c.debit ?? -1], c.decimalComma);
      const cr = centsOf(cells[c.credit ?? -1], c.decimalComma);
      cents = d != null && d !== 0 ? -Math.abs(d) : cr != null && cr !== 0 ? Math.abs(cr) : null;
    }
    if (cents != null && c.flip) cents = -cents;
    const description = (cells[c.description] ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
    const memo = c.memo != null ? (cells[c.memo] ?? "").trim().replace(/\s+/g, " ").slice(0, 500) || null : null;
    if (!day || cents == null || !description) {
      skipped++;
      continue;
    }
    // The same id as Phase 25's CSV reader: re-importing a file read the old way adds nothing.
    const base = `${day}|${cents}|${description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ externalId: `csv:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`, postedOn: day, amountCents: cents, description, memo: memo === description ? null : memo });
  }
  return { rows, skipped };
}

/** Choices someone sent back, checked against the file (columns that exist, a complete amount). */
export function checkChoices(raw: unknown, sheet: Sheet): Choices | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const col = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < sheet.columns ? (v as number) : null);
  const opt = (v: unknown) => (v == null || v === "" ? null : col(Number(v)));
  const date = col(Number(r.date));
  const description = col(Number(r.description));
  const amount = opt(r.amount);
  const debit = opt(r.debit);
  const credit = opt(r.credit);
  if (date == null || description == null) return null;
  if (amount == null && (debit == null || credit == null)) return null;
  const dateOrder = r.dateOrder === "DAY_FIRST" ? "DAY_FIRST" : r.dateOrder === "MONTH_FIRST" ? "MONTH_FIRST" : null;
  if (!dateOrder) return null;
  return {
    date,
    description,
    memo: opt(r.memo),
    amount,
    debit: amount == null ? debit : null,
    credit: amount == null ? credit : null,
    type: opt(r.type),
    dateOrder,
    decimalComma: r.decimalComma === true,
    flip: r.flip === true,
  };
}

/** The US's zones (and its territories'), where dates are written month first. */
const US_ZONES =
  /^(US\/.+|America\/(New_York|Detroit|Kentucky\/.+|Louisville|Indiana\/.+|Indianapolis|Fort_Wayne|Chicago|Menominee|North_Dakota\/.+|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Puerto_Rico|St_Thomas)|Pacific\/(Honolulu|Guam|Saipan|Pago_Pago))$/;

/**
 * The household's order when a file can't tell (the owner's call): the standard where the
 * household is (its zone: month first in the US, day first elsewhere), unless an admin chose one.
 */
export function householdDateOrder(setting: "AUTO" | "MONTH_FIRST" | "DAY_FIRST", timezone: string | null): DateOrder {
  if (setting !== "AUTO") return setting;
  return !timezone || US_ZONES.test(timezone) ? "MONTH_FIRST" : "DAY_FIRST";
}
