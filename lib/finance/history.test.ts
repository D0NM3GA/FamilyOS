import { describe, expect, it } from "vitest";
import { describeEvent, merchantLabel } from "./history";

describe("Phase 30: who changed what", () => {
  it("reads as a sentence with the person's name", () => {
    expect(describeEvent("BUDGET_SET", { category: "Dining", cents: 40000 }, "Mom")).toBe("Mom set Dining's budget to $400.00");
    expect(describeEvent("BUDGET_SET", { category: "Dining", cents: null }, "Mom")).toBe("Mom took the budget off Dining");
    expect(describeEvent("BILL_ANSWERED", { key: "netflix", label: "Netflix", status: "CANCEL" }, "Dad")).toBe("Dad wants to cancel Netflix");
    expect(describeEvent("MEMBER_REMOVED", { name: "Dad", left: true }, "Dad")).toBe("Dad left the jar");
    expect(describeEvent("SURPRISE_MARKED", { for: ["Mom"], until: "2026-12-25" }, "Dad")).toBe("Dad marked a charge 🎁 for Mom until Dec 25");
    expect(describeEvent("ORDER_LINKED", { retailer: "Amazon" }, "Dad")).toBe("Dad linked an Amazon order to a charge");
    expect(describeEvent("ORDER_UNLINKED", { retailer: "Publix" }, "Mom")).toBe("Mom took a Publix order off a charge");
    expect(describeEvent("IMPORTED", { count: 1, account: "Checking" }, "Dad")).toBe("Dad imported 1 transaction into Checking");
    expect(describeEvent("BILL_ADDED", { name: "School fees", cents: 12000, cadence: "QUARTERLY" }, "Mom")).toBe("Mom added a bill by hand: School fees, $120.00 every 3 months");
    expect(describeEvent("BILL_CHANGED", { name: "School fees" }, "Dad")).toBe("Dad changed the bill School fees");
    expect(describeEvent("BILL_REMOVED", { name: "School fees" }, "Dad")).toBe("Dad removed the bill School fees");
    expect(describeEvent("EXPORTED", { month: "2026-08", count: 40 }, "Dad")).toBe("Dad downloaded Aug 2026's activity as a spreadsheet");
    expect(describeEvent("EXPORTED", { month: null, count: 400 }, "Mom")).toBe("Mom downloaded all the activity as a spreadsheet");
    expect(describeEvent("HOLDING_ADDED", { name: "Our house", kind: "HOME" }, "Dad")).toBe("Dad added 🏠 Our house to Net worth");
    expect(describeEvent("HOLDING_VALUED", { name: "Our house", kind: "HOME", cents: 45_000_000, on: "2026-10-01" }, "Mom")).toBe(
      "Mom set Our house to $450,000.00 as of Oct 1",
    );
    expect(describeEvent("HOLDING_VALUED", { name: "Car loan", kind: "LOAN", cents: 1_200_000, on: "2026-10-01" }, "Dad")).toBe(
      "Dad set Car loan to $12,000.00 owed as of Oct 1",
    );
    expect(describeEvent("HOLDING_VALUED", { name: "Car loan", kind: "LOAN", cents: null, on: "2026-09-01" }, "Dad")).toBe("Dad took off Car loan's value from Sep 1");
    expect(describeEvent("HOLDING_REMOVED", { name: "The minivan" }, "Mom")).toBe("Mom removed The minivan from Net worth");
  });
  it("Phase 37: says how the jar's categories changed", () => {
    expect(describeEvent("CATEGORY_RENAMED", { from: "Dining", to: "Eating out", emoji: "🍔" }, "Mom")).toBe("Mom renamed Dining to Eating out");
    expect(describeEvent("CATEGORY_RENAMED", { from: "Dining", to: "Dining", emoji: "🍕" }, "Dad")).toBe("Dad changed Dining's emoji to 🍕");
    expect(describeEvent("CATEGORY_RENAMED", { from: "Dining", to: "Dining", emoji: null }, "Dad")).toBe("Dad took the emoji off Dining");
    expect(describeEvent("CATEGORY_ADDED", { name: "Pets", emoji: "🐾", kind: "SPEND" }, "Mom")).toBe("Mom added 🐾 Pets");
    expect(describeEvent("CATEGORY_ADDED", { name: "Side gig", emoji: null, kind: "INCOME" }, "Dad")).toBe("Dad added Side gig for income");
    // No count: one that includes a surprise hidden from the reader would give it away.
    expect(describeEvent("CATEGORY_REMOVED", { name: "Fun", to: "Other" }, "Mom")).toBe("Mom removed Fun (moved its charges to Other)");
    // A transfer kind can't be added; data that says so reads as the vague sentence.
    expect(describeEvent("CATEGORY_ADDED", { name: "Moves", emoji: null, kind: "TRANSFER" }, "Dad")).toBe("Dad changed something");
  });
  it("never shows raw data it can't read", () => {
    expect(describeEvent("BUDGET_SET", { category: "<b>x</b>".repeat(30), cents: 1 }, "Dad")).toBe("Dad changed something");
    expect(describeEvent("RENAMED", null, "Dad")).toBe("Dad changed something");
  });
  it("labels merchants without the bank's raw text", () => {
    expect(merchantLabel("blue bottle coffee")).toBe("Blue Bottle Coffee");
    expect(merchantLabel("privacy:card-token-1")).toBe("a Privacy.com card");
    expect(merchantLabel("-")).toBe("a merchant");
    expect(merchantLabel(null)).toBe("a merchant");
  });
});
