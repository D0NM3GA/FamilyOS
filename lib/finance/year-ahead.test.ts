import { describe, expect, test } from "vitest";
import { budgetMonth, runningAhead } from "./budget";
import { parseYear, yearCsv, yearMonths, yearSummary } from "./year";

describe("running ahead (Phase 70e)", () => {
  test("past half the budget and more than 15 points ahead of the month gone, before it's over", () => {
    expect(runningAhead(6000, 10000, 0.3)).toBe(true);
    expect(runningAhead(6000, 10000, 0.5)).toBe(false);
    expect(runningAhead(4000, 10000, 0.1)).toBe(false);
    expect(runningAhead(11000, 10000, 0.3)).toBe(false);
    expect(runningAhead(6000, 10000, 1)).toBe(false);
    expect(runningAhead(6000, 0, 0.3)).toBe(false);
  });

  test("the budget line says so", () => {
    const cats = [{ id: "food", key: "dining", name: "Dining", emoji: null, kind: "SPEND" as const, budgetCents: 10000 }];
    const rows = [{ amountCents: -7000, postedOn: "2026-11-05", pending: false, categoryId: "food" }];
    expect(budgetMonth(rows, cats, "2026-11", "2026-11-08").lines[0].status).toBe("AHEAD");
    expect(budgetMonth(rows, cats, "2026-11", "2026-11-25").lines[0].status).toBe("ON_TRACK");
  });
});

describe("the year (Phase 70e)", () => {
  const cats = [
    { id: "food", key: "dining", name: "Dining", emoji: "🍕", kind: "SPEND" as const, budgetCents: null },
    { id: "pay", key: "income", name: "Pay", emoji: null, kind: "INCOME" as const, budgetCents: null },
  ];
  const rows = [
    { amountCents: -2000, postedOn: "2025-01-10", pending: false, categoryId: "food" },
    { amountCents: -3000, postedOn: "2025-07-02", pending: false, categoryId: "food" },
    { amountCents: -500, postedOn: "2025-07-03", pending: false, categoryId: null },
    { amountCents: 100000, postedOn: "2025-03-01", pending: false, categoryId: "pay" },
    { amountCents: -9999, postedOn: "2024-12-31", pending: false, categoryId: "food" },
  ];

  test("months through this one, and a year from the address", () => {
    expect(yearMonths(2026, "2026-03-15")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(yearMonths(2025, "2026-03-15")).toHaveLength(12);
    expect(parseYear("2025", "2026-03-15")).toBe(2025);
    expect(parseYear("2030", "2026-03-15")).toBe(2026);
    expect(parseYear("x", "2026-03-15")).toBe(2026);
  });

  test("spending by category, not yet filed, and income, for that calendar year only", () => {
    const s = yearSummary(rows, cats, 2025, "2026-03-15");
    expect(s.lines.map((l) => [l.category.name, l.spentCents])).toEqual([["Dining", 5000]]);
    expect(s.uncategorizedOutCents).toBe(500);
    expect(s.incomeCents).toBe(100000);
    const csv = yearCsv(s);
    expect(csv).toContain("Total 2025");
    expect(csv).toContain("🍕 Dining,50.00,20.00");
    expect(csv).toContain("Not in a category,5.00");
  });
});
