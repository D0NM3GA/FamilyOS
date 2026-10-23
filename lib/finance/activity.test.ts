import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { ACTIVITY_CSV_COLUMNS, activityCsvName, activityFilters, activityHref, activityWhere, exportMonth, monthSteps, type ActivityCsvRow } from "./activity";
import { visibleToWhere } from "./gifts";

/** The jar's Activity a month at a time, its filters, and its spreadsheet. */

const TODAY = "2026-10-09";

describe("Activity filters", () => {
  it("shows this month unless a past month is asked for", () => {
    expect(activityFilters({}, TODAY)).toEqual({ month: "2026-10", account: null, category: null });
    expect(activityFilters({ month: "2026-08" }, TODAY).month).toBe("2026-08");
    // The future, junk, or a repeated parameter: this month.
    expect(activityFilters({ month: "2026-11" }, TODAY).month).toBe("2026-10");
    expect(activityFilters({ month: "08/2026" }, TODAY).month).toBe("2026-10");
    expect(activityFilters({ month: ["2026-08", "2026-07"] }, TODAY).month).toBe("2026-10");
  });

  it("takes an account and a category (or uncategorized) only as plain ids", () => {
    expect(activityFilters({ account: "acc_1", category: "none" }, TODAY)).toMatchObject({ account: "acc_1", category: "none" });
    expect(activityFilters({ category: "cat-2" }, TODAY).category).toBe("cat-2");
    expect(activityFilters({ account: "x'; drop", category: "a".repeat(65) }, TODAY)).toMatchObject({ account: null, category: null });
  });

  it("links keep every filter", () => {
    expect(activityHref("j1", { month: "2026-08", category: "c1", account: null })).toBe("/finances/j1?category=c1&month=2026-08");
    expect(activityHref("j1", {})).toBe("/finances/j1");
  });

  it("steps a month either way, never past this month", () => {
    expect(monthSteps("2026-10", TODAY)).toEqual({ older: "2026-09", newer: null });
    expect(monthSteps("2026-01", TODAY)).toEqual({ older: "2025-12", newer: "2026-02" });
    expect(monthSteps("2000-01", TODAY).older).toBeNull();
  });

  it("asks only for this jar's rows the viewer may see, in the month and filters", () => {
    expect(activityWhere("j1", "p1", TODAY, { month: "2026-08", account: "a1", category: "none" })).toEqual({
      jarId: "j1",
      state: "ACTIVE",
      ...visibleToWhere("p1", TODAY),
      accountId: "a1",
      categoryId: null,
      postedOn: { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") },
    });
    // Everything (the spreadsheet's "Everything"): no month, still only what they may see.
    const all = activityWhere("j1", "p1", TODAY, { month: null, category: "c1" });
    expect(all).toMatchObject({ jarId: "j1", categoryId: "c1", OR: visibleToWhere("p1", TODAY).OR });
    expect(all).not.toHaveProperty("postedOn");
  });
});

describe("the Activity spreadsheet", () => {
  const row = (over: Partial<ActivityCsvRow> = {}): ActivityCsvRow => ({
    postedOn: new Date("2026-10-05T00:00:00Z"),
    amountCents: -1234,
    description: "SQ *BLUE BOTTLE",
    payee: null,
    merchantName: null,
    memo: null,
    privacyCardMemo: null,
    pending: false,
    account: { name: "Checking", currency: "USD" },
    category: { name: "Dining" },
    ...over,
  });

  it("has a header and one line per charge, money out negative, on the bank's day", () => {
    const csv = toCsv(ACTIVITY_CSV_COLUMNS, [row(), row({ amountCents: 250000, description: "ACME PAYROLL", category: null, pending: true })]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("Date,Name,Bank description,Amount,Currency,Account,Category,Pending,Card nickname,Memo");
    expect(lines[1]).toBe("2026-10-05,SQ *BLUE BOTTLE,SQ *BLUE BOTTLE,-12.34,USD,Checking,Dining,,,");
    expect(lines[2]).toBe("2026-10-05,ACME PAYROLL,ACME PAYROLL,2500.00,USD,Checking,,yes,,");
  });

  it("can't be turned into a formula by a merchant, and quotes commas and quotes", () => {
    const csv = toCsv(ACTIVITY_CSV_COLUMNS, [
      row({ merchantName: '=HYPERLINK("http://evil.example","x")', description: "+1 555 0100", memo: "-Lunch, with \"Nana\"", privacyCardMemo: "@card" }),
    ]);
    const line = csv.replace(/^\uFEFF/, "").split("\r\n")[1];
    expect(line).toBe(`2026-10-05,"'=HYPERLINK(""http://evil.example"",""x"")",'+1 555 0100,-12.34,USD,Checking,Dining,,'@card,"'-Lunch, with ""Nana"""`);
  });

  it("downloads one month or everything, named by our own code", () => {
    expect(exportMonth("2026-08", TODAY)).toEqual({ ok: true, month: "2026-08" });
    expect(exportMonth("all", TODAY)).toEqual({ ok: true, month: null });
    expect(exportMonth("2026-12", TODAY)).toEqual({ ok: false });
    expect(exportMonth(null, TODAY)).toEqual({ ok: false });
    expect(activityCsvName("2026-08", TODAY)).toBe("money-activity-2026-08.csv");
    expect(activityCsvName(null, TODAY)).toBe("money-activity-all-2026-10-09.csv");
  });
});
