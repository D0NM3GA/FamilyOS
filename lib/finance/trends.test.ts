import { describe, expect, it } from "vitest";
import { budgetMonth, parseMonth, type BudgetCategory, type BudgetRow } from "./budget";
import { beforeFrom, beforeFromPace, changeFor, lowerLastMonth, monthChange, paceSoFar, spendingTrend, trendWindow, trimLeading, whereItWent } from "./trends";

const cat = (id: string, kind: BudgetCategory["kind"] = "SPEND"): BudgetCategory => ({ id, key: id, name: id, emoji: null, kind, budgetCents: null });
const CATS = [cat("dining"), cat("groceries"), cat("fun"), cat("income", "INCOME"), cat("transfers", "TRANSFER")];
const row = (postedOn: string, amountCents: number, categoryId: string | null, extra: Partial<BudgetRow> = {}): BudgetRow => ({
  postedOn,
  amountCents,
  pending: false,
  categoryId,
  ...extra,
});

describe("trend window", () => {
  it("is the last 12 months up to this month", () => {
    const w = trendWindow("2026-10", "2026-10");
    expect(w).toHaveLength(12);
    expect(w[0]).toBe("2025-11");
    expect(w[11]).toBe("2026-10");
  });

  it("stays put for a month inside it, so bars don't move when tapped", () => {
    expect(trendWindow("2026-03", "2026-10")).toEqual(trendWindow("2026-10", "2026-10"));
    expect(trendWindow("2025-11", "2026-10")[11]).toBe("2026-10");
  });

  it("slides back for an older month", () => {
    const w = trendWindow("2024-06", "2026-10");
    expect(w[11]).toBe("2024-06");
    expect(w[0]).toBe("2023-07");
  });

  it("trims months before the first row, keeps quiet months after it and the month looked at", () => {
    const w = trendWindow("2026-10", "2026-10");
    const rows = [row("2026-07-15", -100, "dining"), row("2026-10-01", -100, "dining")];
    expect(trimLeading(w, rows, "2026-10")).toEqual({ months: ["2026-07", "2026-08", "2026-09", "2026-10"], first: "2026-07" });
    // Looking at a month before the money starts: shown, but `first` still says where the money starts.
    expect(trimLeading(w, rows, "2026-05")).toEqual({ months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], first: "2026-07" });
    expect(trimLeading(w, [], "2026-10")).toEqual({ months: ["2026-10"], first: null });
  });

  it("ignores the extra month fetched before the window when trimming", () => {
    const w = trendWindow("2026-10", "2026-10");
    expect(trimLeading(w, [row("2025-10-20", -100, "dining"), row("2026-09-01", -100, "dining")], "2026-10").first).toBe("2026-09");
  });
});

describe("spending trend", () => {
  const today = "2026-10-07";
  const months = ["2026-08", "2026-09", "2026-10"];
  const rows: BudgetRow[] = [
    row("2026-08-03", -5000, "dining"),
    row("2026-08-10", -12000, "groceries"),
    row("2026-08-11", 1500, "groceries"), // refund, same month: nets
    row("2026-08-12", 300000, "income"),
    row("2026-08-13", -40000, "transfers"),
    row("2026-08-14", -700, null),
    row("2026-09-02", -8000, "dining"),
    row("2026-09-05", -2500, "dining", { surprise: true }),
    row("2026-09-20", 3000, "fun"), // refund of an August purchase: September clamps to 0
    row("2026-10-02", -1000, "dining", { pending: true }),
    row("2025-01-01", -99999, "dining"), // outside the window
  ];

  it("matches the Budget page's numbers for every month", () => {
    const t = spendingTrend(rows, CATS, months, today);
    months.forEach((m, i) => {
      const b = budgetMonth(rows, CATS, m, today);
      expect(t.months[i]).toMatchObject({
        month: m,
        spentCents: b.spentCents,
        incomeCents: b.incomeCents,
        uncategorizedOutCents: b.uncategorizedOutCents,
        surprisesCents: b.surprisesCents,
        surpriseCount: b.surpriseCount,
        outCents: b.spentCents + b.uncategorizedOutCents,
      });
    });
  });

  it("nets refunds in the month, leaves transfers and income out, keeps uncategorized apart", () => {
    const t = spendingTrend(rows, CATS, months, today);
    const groceries = t.categories.find((c) => c.category.id === "groceries")!;
    expect(groceries.byMonth).toEqual([10500, 0, 0]);
    expect(t.months[0]).toMatchObject({ spentCents: 15500, uncategorizedOutCents: 700, outCents: 16200, incomeCents: 300000 });
  });

  it("clamps a category's month at zero when a refund lands the month after", () => {
    const t = spendingTrend(rows, CATS, months, today);
    // fun has nothing but a refund, so it never shows.
    expect(t.categories.find((c) => c.category.id === "fun")).toBeUndefined();
  });

  it("keeps a surprise hidden from the viewer out of its category, in the Surprises total only", () => {
    const t = spendingTrend(rows, CATS, months, today);
    const dining = t.categories.find((c) => c.category.id === "dining")!;
    expect(dining.byMonth).toEqual([5000, 8000, 1000]);
    expect(t.months[1]).toMatchObject({ surprisesCents: 2500, surpriseCount: 1, spentCents: 10500 });
  });

  it("leaves out categories with nothing in any month, and kinds that aren't spending", () => {
    const t = spendingTrend(rows, CATS, months, today);
    expect(t.categories.map((c) => c.category.id).sort()).toEqual(["dining", "groceries"]);
  });

  it("ignores any carry on the categories", () => {
    const withCarry = CATS.map((c) => ({ ...c, budgetCents: 100, carryInCents: 5000 }));
    expect(spendingTrend(rows, withCarry, months, today).months).toEqual(spendingTrend(rows, CATS, months, today).months);
  });
});

describe("month change", () => {
  it("gives the difference and the percent", () => {
    expect(monthChange(12000, 10000)).toEqual({ deltaCents: 2000, pct: 0.2 });
    expect(monthChange(5000, 10000)).toEqual({ deltaCents: -5000, pct: -0.5 });
  });

  it("has no percent when there was nothing before", () => {
    expect(monthChange(5000, 0)).toEqual({ deltaCents: 5000, pct: null });
    expect(monthChange(0, 0)).toEqual({ deltaCents: 0, pct: null });
  });
});

describe("pace so far", () => {
  it("adds up last month only through today's day of the month", () => {
    const rows = [row("2026-09-03", -1000, "dining"), row("2026-09-07", -2000, "dining"), row("2026-09-08", -4000, "dining"), row("2026-10-01", -500, "dining")];
    expect(paceSoFar(rows, CATS, "2026-10-07").get("dining")).toBe(3000);
  });

  it("takes all of a shorter last month on a day past its end", () => {
    const rows = [row("2026-02-27", -1000, "dining"), row("2026-02-28", -2000, "dining")];
    expect(paceSoFar(rows, CATS, "2026-03-31").get("dining")).toBe(3000);
    expect(paceSoFar(rows, CATS, "2026-03-27").get("dining")).toBe(1000);
  });

  it("is categories only: a surprise adds nothing anywhere", () => {
    const rows = [row("2026-09-03", -2500, "dining", { surprise: true }), row("2026-09-01", -100, null)];
    const pace = paceSoFar(rows, CATS, "2026-10-02");
    expect([...pace.values()].every((n) => n === 0)).toBe(true);
    expect([...pace.keys()].sort()).toEqual(["dining", "fun", "groceries"]);
  });
});

describe("change under each row", () => {
  const rows = [
    row("2026-08-02", -10000, "dining"),
    row("2026-08-03", -2000, null),
    row("2026-08-04", -5000, "fun", { surprise: true }),
    row("2026-09-02", -12000, "dining"),
    row("2026-09-03", -1000, null),
    row("2026-09-04", -3000, "fun", { surprise: true }),
  ];
  const t = spendingTrend(rows, CATS, ["2026-08", "2026-09"], "2026-10-07");
  const slices = whereItWent(t, 1);
  const of = (kind: string) => slices.find((s) => s.kind === kind)!;

  it("compares categories and 'not in a category' with the whole month before", () => {
    const before = beforeFrom(t, 0);
    expect(changeFor(of("category"), before)).toEqual({ deltaCents: 2000, pct: 0.2 });
    expect(changeFor(of("uncategorized"), before)).toEqual({ deltaCents: -1000, pct: -0.5 });
    expect(changeFor({ kind: "quiet", category: cat("groceries") }, before)).toEqual({ deltaCents: 0, pct: null });
  });

  it("never gives surprises a change", () => {
    expect(changeFor(of("surprises"), beforeFrom(t, 0))).toBeNull();
    expect(changeFor(of("surprises"), beforeFromPace(new Map()))).toBeNull();
  });

  it("gives 'not in a category' no change against a pace (categories only)", () => {
    expect(changeFor(of("uncategorized"), beforeFromPace(new Map([["dining", 4000]])))).toBeNull();
    expect(changeFor(of("category"), beforeFromPace(new Map([["dining", 4000]])))).toEqual({ deltaCents: 8000, pct: 2 });
  });

  it("has nothing to compare with before the first month", () => {
    expect(beforeFrom(t, -1)).toBeNull();
    expect(changeFor(of("category"), null)).toBeNull();
  });
});

describe("month in the address", () => {
  it("takes YYYY-MM from 2000-01 up to this month only", () => {
    expect(parseMonth("2026-09", "2026-10")).toBe("2026-09");
    expect(parseMonth("2026-10", "2026-10")).toBe("2026-10");
    expect(parseMonth("2026-11", "2026-10")).toBeNull();
    expect(parseMonth("1999-12", "2026-10")).toBeNull();
    expect(parseMonth("2026-13", "2026-10")).toBeNull();
    expect(parseMonth("2026-9", "2026-10")).toBeNull();
    expect(parseMonth(["2026-09"], "2026-10")).toBeNull();
    expect(parseMonth(undefined, "2026-10")).toBeNull();
  });
});

describe("where it went", () => {
  const rows = [
    row("2026-09-02", -8000, "dining"),
    row("2026-09-03", -12000, "groceries"),
    row("2026-09-04", -2000, null),
    row("2026-09-05", -3000, "fun", { surprise: true }),
  ];
  const t = spendingTrend(rows, CATS, ["2026-09"], "2026-10-07");

  it("lists the month biggest first, with shares of what went out", () => {
    const s = whereItWent(t, 0);
    expect(s.map((x) => (x.kind === "category" ? x.category.id : x.kind))).toEqual(["groceries", "dining", "surprises", "uncategorized"]);
    expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 10);
    expect(s.find((x) => x.kind === "surprises")).toMatchObject({ cents: 3000, count: 1 });
  });

  it("leaves out empty slices", () => {
    const quiet = spendingTrend([row("2026-09-02", -100, "dining")], CATS, ["2026-09"], "2026-10-07");
    expect(whereItWent(quiet, 0).map((x) => x.kind)).toEqual(["category"]);
    expect(whereItWent(quiet, 3)).toEqual([]);
  });
});

describe("Bunson's 'came in lower' note", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const trendOf = (aug: number, sep: number, oct = 0) =>
    spendingTrend(
      [row("2026-07-02", -100, "groceries"), row("2026-08-02", -aug, "dining"), row("2026-09-02", -sep, "dining"), row("2026-10-02", -oct, "dining")],
      CATS,
      months,
      "2026-10-07",
    );

  it("names a category that dropped by 20% and $25 between the last two whole months", () => {
    expect(lowerLastMonth(trendOf(20000, 15000), "2026-10")?.id).toBe("dining");
  });

  it("says nothing for small drops, rises, or tiny months", () => {
    expect(lowerLastMonth(trendOf(20000, 17000), "2026-10")).toBeNull(); // 15%
    expect(lowerLastMonth(trendOf(10000, 12000), "2026-10")).toBeNull();
    expect(lowerLastMonth(trendOf(2000, 0), "2026-10")).toBeNull(); // under $25 before
    expect(lowerLastMonth(trendOf(10000, 8000), "2026-10")).toBeNull(); // $20 drop
  });

  it("never compares the month in progress", () => {
    expect(lowerLastMonth(trendOf(20000, 20000, 0), "2026-10")).toBeNull();
  });

  it("never uses the first month shown as 'before' (it may be part of a month)", () => {
    const t = spendingTrend([row("2026-08-02", -20000, "dining"), row("2026-09-02", -1000, "dining")], CATS, ["2026-08", "2026-09", "2026-10"], "2026-10-07");
    expect(lowerLastMonth(t, "2026-10")).toBeNull();
  });
});
