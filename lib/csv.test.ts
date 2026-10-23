import { describe, expect, test } from "vitest";
import { csvDate, csvMoney, escapeCell, guardFormula, toCsv, type CsvColumn } from "./csv";

type Row = { name: string; points: number; note: string | null };

const columns: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name, freeText: true },
  { header: "Points", value: (r) => r.points },
  { header: "Note", value: (r) => r.note, freeText: true },
];

describe("toCsv", () => {
  test("starts with a UTF-8 BOM and uses CRLF line endings", () => {
    const csv = toCsv(columns, [{ name: "Ada", points: 3, note: null }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe("\uFEFFName,Points,Note\r\nAda,3,\r\n");
  });

  test("quotes cells with commas, quotes and newlines, doubling inner quotes", () => {
    const csv = toCsv(columns, [{ name: 'Ada "the kid", Jr', points: 1, note: "line1\nline2" }]);
    expect(csv).toContain('"Ada ""the kid"", Jr"');
    expect(csv).toContain('"line1\nline2"');
  });

  test("guards free-text formulas, but leaves numbers we format ourselves alone", () => {
    const csv = toCsv(columns, [{ name: "=HYPERLINK(\"http://evil\")", points: -5, note: "@SUM(A1)" }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",-5,");
    expect(csv).toContain("'@SUM(A1)");
  });

  test.each(["=1+1", "+1 555 0100", "-2", "@x", "\tx", "\rx"])("guardFormula prefixes %j", (text) => {
    expect(guardFormula(text).startsWith("'")).toBe(true);
  });

  test("keeps ordinary text as-is", () => {
    expect(guardFormula("Milk")).toBe("Milk");
    expect(escapeCell("Milk")).toBe("Milk");
  });

  test("null and undefined become empty cells", () => {
    expect(toCsv(columns, [{ name: "A", points: 0, note: null }])).toContain("A,0,\r\n");
  });
});

describe("value helpers", () => {
  test("csvDate is the local calendar date", () => {
    expect(csvDate(new Date(2026, 8, 5))).toBe("2026-09-05");
    expect(csvDate(null)).toBe("");
  });

  test("csvMoney formats integer cents without float math", () => {
    expect(csvMoney(1999)).toBe("19.99");
    expect(csvMoney(5)).toBe("0.05");
    expect(csvMoney(-250)).toBe("-2.50");
    expect(csvMoney(null)).toBe("");
  });
});
