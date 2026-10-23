import { describe, expect, it } from "vitest";
import { guessCategory, merchantKeyOf } from "./categories";
import { budgetMonth, monthRange, shiftMonth, todayCivil, type BudgetCategory } from "./budget";
import { findRecurring, type RecurringRow, type RowCategory } from "./recurring";
import { matchTrips } from "./grocery-link";
import type { CategoryKind } from "./categories";

const cat = (key: string, kind: CategoryKind = "SPEND", absorbedKeys: string[] = []): RowCategory => ({ key, absorbedKeys, kind });

describe("merchantKeyOf", () => {
  it("is the same merchant before and after Privacy enrichment", () => {
    expect(merchantKeyOf({ description: "PWP*NETFLIX.COM PRIVACY.COM" })).toBe("netflix");
    expect(merchantKeyOf({ merchantName: "NETFLIX.COM", description: "PWP*NETFLIX.COM PRIVACY.COM" })).toBe("netflix");
  });
  it("drops store numbers, dates and states", () => {
    expect(merchantKeyOf({ description: "KROGER #0412 CINCINNATI OH" })).toBe("kroger cincinnati");
    expect(merchantKeyOf({ description: "SQ *BLUE BOTTLE COFFEE 10/04" })).toBe("blue bottle coffee");
    expect(merchantKeyOf({ payee: "Amazon", description: "AMZN Mktp US*2K4" })).toBe("amazon");
    expect(merchantKeyOf({ description: "ALDI 55" })).toBe("aldi");
  });
});

describe("guessCategory", () => {
  it.each([
    ["kroger cincinnati", -8214, "groceries"],
    ["netflix", -1599, "subscriptions"],
    ["chase card payment thank you", -50000, "transfers"],
    ["acme payroll", 250000, "income"],
    ["shell oil", -4000, "car"],
    ["starbucks", -550, "dining"],
    ["amazon", -2999, "shopping"],
    ["mystery thing", -100, null],
    ["amazon", 2999, null],
  ])("%s %d → %s", (key, cents, cat) => {
    expect(guessCategory(key as string, cents as number)).toBe(cat);
  });
});

describe("budgetMonth", () => {
  const cats: BudgetCategory[] = [
    { id: "g", key: "groceries", name: "Groceries", emoji: "🛒", kind: "SPEND", budgetCents: 60000 },
    { id: "d", key: "dining", name: "Dining", emoji: "🍔", kind: "SPEND", budgetCents: 10000 },
    { id: "i", key: "income", name: "Income", emoji: "💵", kind: "INCOME", budgetCents: null },
    { id: "t", key: "transfers", name: "Transfers", emoji: "🔄", kind: "TRANSFER", budgetCents: null },
  ];
  const row = (amountCents: number, postedOn: string, categoryId: string | null, pending = false) => ({ amountCents, postedOn, categoryId, pending });

  it("sums spending net of refunds, counts pending, ignores transfers, takes the UTC month", () => {
    const s = budgetMonth(
      [
        row(-50000, "2026-10-01", "g"),
        row(-2000, "2026-10-31", "g", true),
        row(1000, "2026-10-15", "g"),
        row(-15000, "2026-10-10", "d"),
        row(-99999, "2026-10-12", "t"),
        row(250000, "2026-10-15", "i"),
        row(-700, "2026-10-16", null),
        row(-123, "2026-09-30", "g"),
        row(-456, "2026-11-01", "g"),
      ],
      cats,
      "2026-10",
      "2026-10-15",
    );
    const g = s.lines.find((l) => l.category.key === "groceries")!;
    expect(g).toMatchObject({ spentCents: 51000, pendingCents: 2000, status: "ON_TRACK" });
    expect(s.lines.find((l) => l.category.key === "dining")!.status).toBe("OVER");
    expect(s.incomeCents).toBe(250000);
    expect(s.uncategorizedOutCents).toBe(700);
    expect(s.spentCents).toBe(66000);
    expect(s.monthGone).toBeCloseTo(15 / 31);
  });

  it("future months have no status; past months are fully gone", () => {
    expect(budgetMonth([], cats, "2026-11", "2026-10-15").lines[0].status).toBeNull();
    expect(budgetMonth([], cats, "2026-09", "2026-10-15").monthGone).toBe(1);
  });

  it("month helpers", () => {
    expect(monthRange("2026-12")).toEqual({ gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(todayCivil(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});

describe("findRecurring", () => {
  const r = (key: string, postedOn: string, amountCents: number, extra: Partial<RecurringRow> = {}): RecurringRow => ({
    key,
    label: key,
    postedOn,
    amountCents,
    privacyCardToken: null,
    privacyCardMemo: null,
    category: null,
    ...extra,
  });

  it("finds monthly, biweekly and weekly charges, with varying amounts allowed", () => {
    const rows = [
      r("electric", "2026-07-03", -8000),
      r("electric", "2026-08-04", -14000),
      r("electric", "2026-09-02", -12000),
      r("daycare", "2026-09-05", -40000),
      r("daycare", "2026-09-19", -40000),
      r("daycare", "2026-10-03", -40000),
      r("lawn", "2026-09-20", -3000),
      r("lawn", "2026-09-27", -3000),
      r("lawn", "2026-10-04", -3000),
      r("random", "2026-07-01", -500),
      r("random", "2026-07-20", -500),
      r("random", "2026-09-30", -500),
    ];
    const found = findRecurring(rows);
    expect(Object.fromEntries(found.map((f) => [f.key, f.cadence]))).toEqual({ electric: "MONTHLY", daycare: "BIWEEKLY", lawn: "WEEKLY" });
    const electric = found.find((f) => f.key === "electric")!;
    expect(electric).toMatchObject({ typicalCents: 12000, steady: false, lastOn: "2026-09-02", nextOn: "2026-10-02" });
  });

  it("a Privacy.com card is a subscription from its first charge, labelled by its nickname", () => {
    const [sub] = findRecurring([r("netflix", "2026-10-01", -1599, { privacyCardToken: "c1", privacyCardMemo: "Netflix" })]);
    expect(sub).toMatchObject({ key: "privacy:c1", label: "Netflix", isSubscription: true, cadence: null });
  });

  it("refunds and transfers aren't bills", () => {
    expect(findRecurring([r("x", "2026-08-01", 500), r("x", "2026-09-01", 500), r("x", "2026-10-01", 500)])).toEqual([]);
  });
});

describe("matchTrips", () => {
  it("links only one-to-one, within the posting window", () => {
    expect(matchTrips([{ id: "t1", postedOn: "2026-10-06" }], [{ id: "p1", day: "2026-10-04" }])).toEqual([["t1", "p1"]]);
    // Two charges, one trip: ask a person.
    expect(matchTrips([{ id: "t1", postedOn: "2026-10-05" }, { id: "t2", postedOn: "2026-10-06" }], [{ id: "p1", day: "2026-10-04" }])).toEqual([]);
    // Posted before the trip (beyond a day) or too late: no.
    expect(matchTrips([{ id: "t1", postedOn: "2026-10-01" }], [{ id: "p1", day: "2026-10-04" }])).toEqual([]);
    expect(matchTrips([{ id: "t1", postedOn: "2026-10-09" }], [{ id: "p1", day: "2026-10-04" }])).toEqual([]);
  });
});

describe("Phase 27: quarterly and yearly bills", () => {
  const r = (key: string, postedOn: string, amountCents: number, extra: Partial<RecurringRow> = {}): RecurringRow => ({
    key,
    label: key,
    postedOn,
    amountCents,
    privacyCardToken: null,
    privacyCardMemo: null,
    category: null,
    ...extra,
  });

  it("finds quarterly charges from three, and yearly bills from two when steady and bill-like", () => {
    const found = findRecurring(
      [
        r("water", "2026-01-10", -9000),
        r("water", "2026-04-11", -9500),
        r("water", "2026-07-09", -8800),
        r("costco", "2025-09-01", -6500, { category: cat("bills") }),
        r("costco", "2026-09-02", -6500, { category: cat("bills") }),
      ],
      "2026-09-20",
    );
    expect(Object.fromEntries(found.map((f) => [f.key, f.cadence]))).toEqual({ water: "QUARTERLY", costco: "YEARLY" });
    expect(found.find((f) => f.key === "costco")).toMatchObject({ nextOn: "2027-09-02", stopped: false, merchantKey: "costco" });
  });

  it("Phase 37: a category that took in Bills or Subscriptions finds bills as they did", () => {
    const tookBills = cat("household-k3x9q2", "SPEND", ["bills"]);
    const yearly = findRecurring([r("insure", "2025-05-01", -40000, { category: tookBills }), r("insure", "2026-05-01", -40000, { category: tookBills })], "2026-05-20");
    expect(yearly).toMatchObject([{ key: "insure", cadence: "YEARLY" }]);
    const tookSubs = cat("other", "SPEND", ["subscriptions"]);
    const monthly = ["2026-07-15", "2026-08-15", "2026-09-15"].map((d) => r("streamy", d, -999, { category: tookSubs }));
    expect(findRecurring(monthly, "2026-09-20")[0].isSubscription).toBe(true);
    expect(findRecurring(monthly.map((x) => ({ ...x, category: cat("other") })), "2026-09-20")[0].isSubscription).toBe(false);
  });

  it("two shopping trips a year apart, or two unsteady amounts, aren't a yearly bill", () => {
    expect(findRecurring([r("home depot", "2025-05-01", -4000, { category: cat("home") }), r("home depot", "2026-05-01", -4000, { category: cat("home") })])).toEqual([]);
    expect(findRecurring([r("insure", "2025-05-01", -40000, { category: cat("bills") }), r("insure", "2026-05-01", -90000, { category: cat("bills") })])).toEqual([]);
    // Two monthly charges are still not enough for "monthly".
    expect(findRecurring([r("gym", "2026-08-01", -3000, { category: cat("bills") }), r("gym", "2026-09-01", -3000, { category: cat("bills") })])).toEqual([]);
  });

  it("'may have stopped' allows each cadence its own grace", () => {
    const monthly = [r("m", "2026-06-01", -100), r("m", "2026-07-01", -100), r("m", "2026-08-01", -100)];
    expect(findRecurring(monthly, "2026-09-07")[0].stopped).toBe(false);
    expect(findRecurring(monthly, "2026-09-09")[0].stopped).toBe(true);
    const yearly = [r("y", "2024-09-01", -500, { category: cat("subscriptions") }), r("y", "2025-09-01", -500, { category: cat("subscriptions") })];
    expect(findRecurring(yearly, "2026-09-20")[0].stopped).toBe(false);
    expect(findRecurring(yearly, "2026-09-25")[0].stopped).toBe(true);
    expect(findRecurring(yearly)[0].stopped).toBe(false);
  });
});

describe("Phase 27: surprises in the budget", () => {
  const cats: BudgetCategory[] = [
    { id: "s", key: "shopping", name: "Shopping", emoji: "🛍️", kind: "SPEND", budgetCents: 10000 },
    { id: "i", key: "income", name: "Income", emoji: "💵", kind: "INCOME", budgetCents: null },
  ];
  it("a hidden surprise skips every bucket but still counts toward Spent", () => {
    const s = budgetMonth(
      [
        { amountCents: -3000, postedOn: "2026-10-02", pending: false, categoryId: "s" },
        { amountCents: -12000, postedOn: "2026-10-03", pending: false, categoryId: "s", surprise: true },
        { amountCents: -500, postedOn: "2026-10-04", pending: false, categoryId: null, surprise: true },
        { amountCents: 2000, postedOn: "2026-10-05", pending: false, categoryId: "i", surprise: true },
      ],
      cats,
      "2026-10",
      "2026-10-15",
    );
    const shopping = s.lines.find((l) => l.category.key === "shopping")!;
    expect(shopping).toMatchObject({ spentCents: 3000, status: "ON_TRACK" });
    expect(s).toMatchObject({ surprisesCents: 10500, surpriseCount: 3, uncategorizedOutCents: 0, incomeCents: 0, spentCents: 13500 });
  });
});
