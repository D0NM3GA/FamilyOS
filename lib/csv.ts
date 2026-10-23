/**
 * CSV writer for the per-domain exports (Phase 16). Kernel, pure, no dependencies.
 *
 * - RFC 4180: CRLF line endings; a cell containing `,` `"` CR or LF is quoted, and inner
 *   quotes are doubled.
 * - A UTF-8 byte-order mark up front, so Excel reads accents and emoji correctly.
 * - **Formula-injection guard** on free-text columns: a cell that starts with `=` `+` `-`
 *   `@`, tab or CR is prefixed with `'`, so Excel/Sheets show it as text instead of
 *   running it as a formula. Names, notes and titles are user input, and these files are
 *   meant to be opened in Excel. It applies to free-text columns only, so numbers we format
 *   ourselves (a `-5` points delta) aren't mangled. A phone number like `+1 555…` gets the
 *   apostrophe too; deliberately no "looks like a phone" exception, since that's exactly
 *   the kind of carve-out that reopens the hole.
 */

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
  /** User-typed text: gets the formula-injection guard. */
  freeText?: boolean;
};

const BOM = "\uFEFF";
const FORMULA_START = /^[=+\-@\t\r]/;

export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function escapeCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cell<Row>(column: CsvColumn<Row>, row: Row): string {
  const raw = column.value(row);
  if (raw == null) return "";
  const text = String(raw);
  return escapeCell(column.freeText ? guardFormula(text) : text);
}

export function toCsv<Row>(columns: CsvColumn<Row>[], rows: readonly Row[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c, row)).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** A local calendar date as YYYY-MM-DD — for date-only fields stored as local midnight. */
export function csvDate(date: Date | null | undefined): string {
  if (!date) return "";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** A full timestamp as ISO 8601 UTC — never a locale format. */
export function csvDateTime(date: Date | null | undefined): string {
  return date ? date.toISOString() : "";
}

/** A local date and time as "YYYY-MM-DD HH:mm" — readable in Excel, e.g. a med dose time. */
export function csvLocalDateTime(date: Date | null | undefined): string {
  if (!date) return "";
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${csvDate(date)} ${h}:${min}`;
}

/** Integer cents -> "12.34", with no currency symbol and no float math on the stored value. */
export function csvMoney(cents: number | null | undefined): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
