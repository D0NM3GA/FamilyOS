import { describe, expect, it, test } from "vitest";
import { centsToInput, decimalToCents, formatMoney, parseMoneyInput } from "./money";

describe("decimalToCents", () => {
  it("parses bank decimal strings exactly", () => {
    expect(decimalToCents("-12.34")).toBe(-1234);
    expect(decimalToCents("5")).toBe(500);
    expect(decimalToCents("0.5")).toBe(50);
    expect(decimalToCents("+1,234.56")).toBe(123456);
    expect(decimalToCents("0.07")).toBe(7);
    expect(decimalToCents(19.99)).toBe(1999);
  });
  it("rejects what it can't represent", () => {
    for (const bad of ["1.234", "abc", "", "1e5", "--1", null, undefined, "99999999999999"]) expect(decimalToCents(bad)).toBeNull();
  });
});

describe("parseMoneyInput", () => {
  test.each([
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    ["$12.34", 1234],
    ["$1,234.56", 123456], // LubeLogger exports Cost as ToString("C")
    [".5", 50],
    ["0", 0],
    ["19.99", 1999], // the float-drift case: 19.99 * 100 !== 1999 in floating point
  ])("%s -> %i cents", (raw, cents) => {
    expect(parseMoneyInput(raw)).toEqual({ ok: true, cents });
  });

  test("blank means not recorded (null), not $0", () => {
    expect(parseMoneyInput("  ")).toEqual({ ok: true, cents: null });
  });

  test.each(["-5", "12.345", "abc", "$", ".", "1.2.3"])("rejects %s", (raw) => {
    expect(parseMoneyInput(raw).ok).toBe(false);
  });

  test("caps absurd amounts", () => {
    expect(parseMoneyInput("1000000.01").ok).toBe(false);
    expect(parseMoneyInput("1000000")).toEqual({ ok: true, cents: 100_000_000 });
    expect(parseMoneyInput("50.01", { max: 5000 }).ok).toBe(false);
  });
});

describe("centsToInput", () => {
  it("shows what was saved, without trailing .00", () => {
    expect(centsToInput(4000)).toBe("40");
    expect(centsToInput(1250)).toBe("12.50");
    expect(centsToInput(5)).toBe("0.05");
    expect(centsToInput(null)).toBe("");
  });
});

describe("formatMoney", () => {
  it("formats known currencies and falls back for others", () => {
    expect(formatMoney(-1234)).toBe("-$12.34");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(500, "https://example.com/points")).toBe("5.00");
  });
});
