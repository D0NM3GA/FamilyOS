import { createHash } from "node:crypto";
import { decimalToCents } from "@/lib/money";

/**
 * Phase 25: statement files a bank lets you download, for history before the bank feed or
 * banks SimpleFIN can't reach. OFX/QFX first (every row has the bank's own FITID, so a
 * re-import is a no-op); CSV kept strict (a date column, and amount or debit + credit).
 * Pure: text in, rows out.
 */

export type ImportedRow = {
  externalId: string;
  /** Civil day YYYY-MM-DD. */
  postedOn: string;
  amountCents: number;
  description: string;
  memo: string | null;
};

export type ImportResult = { ok: true; rows: ImportedRow[]; format: "ofx" | "csv"; skipped: number } | { ok: false; error: string };

const MAX_ROWS = 10_000;

function tag(block: string, name: string): string | null {
  // OFX 1.x is SGML (tags often unclosed); 2.x is XML. Take the text after <NAME> up to the next tag.
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  const v = m?.[1]?.trim();
  return v ? v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
}

function ofxDay(raw: string | null): string | null {
  // DTPOSTED is YYYYMMDD[HHMMSS[.XXX]][[-5:EST]]: the first 8 digits are the civil day.
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validDay(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

export function parseOfx(text: string): ImportResult {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (blocks.length === 0) return { ok: false, error: "No transactions in that file." };
  const rows: ImportedRow[] = [];
  let skipped = 0;
  for (const block of blocks.slice(0, MAX_ROWS)) {
    const fitid = tag(block, "FITID");
    const day = ofxDay(tag(block, "DTPOSTED"));
    const cents = decimalToCents(tag(block, "TRNAMT"));
    if (!fitid || !day || cents == null) {
      skipped++;
      continue;
    }
    const name = tag(block, "NAME") ?? tag(block, "PAYEE") ?? "";
    const memo = tag(block, "MEMO");
    rows.push({ externalId: `ofx:${fitid.slice(0, 200)}`, postedOn: day, amountCents: cents, description: (name || memo || "Transaction").slice(0, 500), memo: memo?.slice(0, 500) ?? null });
  }
  return rows.length ? { ok: true, rows, format: "ofx", skipped } : { ok: false, error: "Couldn't read any transactions in that file." };
}

/** RFC 4180-ish: quoted fields, doubled quotes, separators and newlines inside quotes. Phase 52: any one-character separator. */
export function splitCsv(text: string, separator = ","): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) out.push(row);
      row = [];
      field = "";
      if (out.length > MAX_ROWS + 1) break;
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) out.push(row);
  return out;
}

function csvDay(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDay(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function money(raw: string | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  // Unicode minus and "CR"/"DR" suffixes some banks use.
  let t = raw.trim().replace(/\u2212/g, "-").replace(/[$\s]/g, "");
  const cr = /^(.*?)(CR|DR)$/i.exec(t);
  if (cr) t = cr[2].toUpperCase() === "DR" ? `-${cr[1]}` : cr[1];
  const paren = /^\((.*)\)$/.exec(t);
  if (paren) t = `-${paren[1]}`;
  return decimalToCents(t);
}

const find = (header: string[], ...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h.trim().toLowerCase())));

export function parseCsv(text: string): ImportResult {
  const table = splitCsv(text.replace(/^\uFEFF/, ""));
  if (table.length < 2) return { ok: false, error: "That file has no rows." };
  const header = table[0];
  const date = find(header, /^(posted |transaction |posting )?date$/, /^date posted$/);
  const desc = find(header, /^description$/, /^payee$/, /^name$/, /^merchant$/, /^details$/, /^memo$/);
  const amount = find(header, /^amount$/, /^transaction amount$/);
  const debit = find(header, /^debit( amount)?$/, /^withdrawals?$/);
  const credit = find(header, /^credit( amount)?$/, /^deposits?$/);
  if (date < 0 || desc < 0 || (amount < 0 && (debit < 0 || credit < 0))) {
    return { ok: false, error: "Couldn't tell which columns are the date, description and amount. Try the bank's OFX/QFX download instead." };
  }

  const seen = new Map<string, number>();
  const rows: ImportedRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(1, MAX_ROWS + 1)) {
    const day = csvDay(cells[date] ?? "");
    let cents: number | null;
    if (amount >= 0) cents = money(cells[amount]);
    else {
      const d = money(cells[debit]);
      const c = money(cells[credit]);
      cents = d != null && d !== 0 ? -Math.abs(d) : c != null && c !== 0 ? Math.abs(c) : null;
    }
    const description = (cells[desc] ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
    if (!day || cents == null || !description) {
      skipped++;
      continue;
    }
    // No bank id in a CSV: the same row (same day, amount, text, and its place among identical
    // rows that day) always hashes the same, so re-importing the same file adds nothing.
    const base = `${day}|${cents}|${description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({ externalId: `csv:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`, postedOn: day, amountCents: cents, description, memo: null });
  }
  return rows.length ? { ok: true, rows, format: "csv", skipped } : { ok: false, error: "Couldn't read any transactions in that file." };
}

/** OFX/QFX by content, else CSV. */
export function parseStatement(text: string): ImportResult {
  return /<OFX>|OFXHEADER|<STMTTRN>/i.test(text) ? parseOfx(text) : parseCsv(text);
}
