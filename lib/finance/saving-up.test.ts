import { describe, expect, it } from "vitest";
import { budgetMonth, type BudgetRow } from "./budget";
import { carryIn, carryMonths, carryStart, goalPlan, withCarry, type RolloverCategory } from "./envelope";
import { comingUp, priceChangeOf, type Recurring } from "./recurring";
import { priceUpAlert } from "./alerts";
import { describeEvent } from "./history";

/** Phase 31: saving up, coming up and price changes (pure). */

const school: RolloverCategory = { id: "c1", key: "school", name: "School", emoji: null, kind: "SPEND", budgetCents: 10000, rollover: true, rolloverFrom: "2026-07" };
const row = (postedOn: string, amountCents: number, extra: Partial<BudgetRow> = {}): BudgetRow => ({ postedOn, amountCents, pending: false, categoryId: "c1", ...extra });

describe("rollover carry", () => {
  it("adds up what each month left, and overspending carries too", () => {
    expect(carryMonths("2026-07", "2026-10")).toEqual(["2026-07", "2026-08", "2026-09"]);
    const spent = new Map([
      ["2026-07", 2000],
      ["2026-08", 15000],
    ]);
    // +80, −50, +100
    expect(carryIn("2026-07", "2026-10", 10000, spent)).toBe(13000);
    expect(carryIn("2026-10", "2026-10", 10000, spent)).toBe(0);
    expect(carryIn(null, "2026-10", 10000, spent)).toBe(0);
  });

  it("counts at most 24 months", () => {
    expect(carryMonths("2020-01", "2026-10")).toHaveLength(24);
    expect(carryMonths("2020-01", "2026-10")[0]).toBe("2024-10");
    expect(carryStart([school, { rollover: false, rolloverFrom: null }], "2026-10")).toBe("2026-07");
    expect(carryStart([{ rollover: true, rolloverFrom: "2020-01" }], "2026-10")).toBe("2024-10");
    expect(carryStart([school], "2026-07")).toBeNull();
  });

  it("is over only past budget + carry, and anything spent once the carry is below zero", () => {
    const rows = [row("2026-07-03", -2000), row("2026-08-10", -1000), row("2026-08-11", 500), row("2026-09-01", -3000, { categoryId: "other" })];
    const [cat] = withCarry([school], rows, "2026-10");
    // Jul +80, Aug +95 (the refund takes $5 back), Sep +100
    expect(cat.carryInCents).toBe(27500);
    const oct = budgetMonth([row("2026-10-02", -30000)], [cat], "2026-10", "2026-10-15");
    expect(oct.lines[0]).toMatchObject({ availableCents: 37500, status: "ON_TRACK" });
    expect(oct.budgetedCents).toBe(10000);

    const broke = { ...school, rolloverFrom: "2026-09" };
    const [b] = withCarry([broke], [row("2026-09-05", -25000)], "2026-10");
    expect(b.carryInCents).toBe(-15000);
    expect(budgetMonth([row("2026-10-02", -100)], [b], "2026-10", "2026-10-15").lines[0].status).toBe("OVER");
  });

  it("leaves surprises hidden from the viewer out, and months before it was on are plain", () => {
    const [hidden] = withCarry([school], [row("2026-08-01", -9000, { surprise: true })], "2026-09");
    expect(hidden.carryInCents).toBe(20000);
    const [before] = withCarry([school], [], "2026-06");
    expect(before.carryInCents).toBeUndefined();
    const [plain] = withCarry([{ ...school, rollover: false }], [], "2026-10");
    expect(plain.carryInCents).toBeUndefined();
    expect(budgetMonth([], [plain], "2026-10", "2026-10-15").lines[0].availableCents).toBeNull();
  });
});

describe("goal plan", () => {
  it("spreads what's still missing over the months after this one, rounded up to whole dollars", () => {
    expect(goalPlan(40000, "2027-01", 10000, "2026-10")).toEqual({ monthsAfter: 3, perMonthCents: 10000, reached: false, remainingCents: 30000, past: false });
    expect(goalPlan(40001, "2027-01", 10000, "2026-10").perMonthCents).toBe(10100);
    expect(goalPlan(40000, "2026-10", 0, "2026-10")).toMatchObject({ monthsAfter: 0, perMonthCents: 40000, past: false });
    expect(goalPlan(40000, "2026-08", 1000, "2026-10")).toMatchObject({ monthsAfter: 0, perMonthCents: 39000, reached: false, past: true });
    expect(goalPlan(40000, "2027-01", 50000, "2026-10")).toMatchObject({ reached: true, perMonthCents: 0 });
    // Spending this month below the goal again: not reached, and never "put aside $0".
    const dipped = goalPlan(40000, "2027-01", 35000, "2026-10");
    expect(dipped.reached).toBe(false);
    expect(dipped.perMonthCents).toBeGreaterThan(0);
  });
});

const bill = (over: Partial<Recurring> = {}): Recurring => ({
  key: "netflix",
  label: "NETFLIX.COM",
  merchantKey: "netflix",
  cadence: "MONTHLY",
  typicalCents: 1599,
  steady: true,
  lastOn: "2026-09-20",
  nextOn: "2026-10-20",
  count: 4,
  isSubscription: true,
  cardMemo: null,
  stopped: false,
  priceChange: null,
  recentCents: [],
  ...over,
});

describe("coming up", () => {
  it("lists regular bills in the next 30 days (and late ones), in order, with a total", () => {
    const found = [
      bill(),
      bill({ key: "water", label: "Water", isSubscription: false, nextOn: "2026-10-03", typicalCents: 4500, steady: false }),
      bill({ key: "far", nextOn: "2026-11-30" }),
      bill({ key: "old", nextOn: "2026-09-30" }),
      bill({ key: "shop", cadence: "WEEKLY", isSubscription: false, nextOn: "2026-10-08" }),
      bill({ key: "gone", stopped: true }),
      bill({ key: "nope", nextOn: "2026-10-09" }),
      bill({ key: "cut", nextOn: "2026-10-10" }),
    ];
    const status = new Map([
      ["nope", "HIDDEN"],
      ["cut", "CANCEL"],
    ]);
    const up = comingUp(found, status, "2026-10-06");
    expect(up.items.map((i) => i.key)).toEqual(["water", "cut", "netflix"]);
    expect(up.items.find((i) => i.key === "cut")?.cancelling).toBe(true);
    expect(up.totalCents).toBe(4500 + 1599 + 1599);
    expect(comingUp(found, status, "2026-10-06", 3).items.map((i) => i.key)).toEqual(["water"]);
  });
});

describe("price changes", () => {
  const charges = (...cents: number[]) => cents.map((c, i) => ({ postedOn: `2026-0${i + 3}-15`, cents: c }));
  it("flags a settled change only", () => {
    expect(priceChangeOf(charges(1599, 1599, 1799, 1799))).toEqual({ fromCents: 1599, toCents: 1799, sinceOn: "2026-05-15", confirmedOn: "2026-06-15" });
    // It stays flagged on later charges at the new price.
    expect(priceChangeOf(charges(1599, 1599, 1799, 1799, 1799))).toMatchObject({ fromCents: 1599, toCents: 1799, sinceOn: "2026-05-15" });
    expect(priceChangeOf(charges(1799, 1799, 1599, 1599))).toMatchObject({ fromCents: 1799, toCents: 1599 });
    // One odd charge, a wobbly utility, too small a move, too few charges.
    expect(priceChangeOf(charges(1599, 1599, 1599, 1799))).toBeNull();
    expect(priceChangeOf(charges(8000, 9100, 9900, 9950))).toBeNull();
    expect(priceChangeOf(charges(10000, 10000, 10300, 10300))).toBeNull();
    expect(priceChangeOf(charges(1599, 1799, 1799))).toBeNull();
    expect(priceChangeOf(charges(10000, 10000, 10100, 10100))).toBeNull(); // exactly $1 isn't "more than"
  });

  it("finds a second rise in a long history (a bill that went up last year too)", () => {
    const history = [...Array(12).fill(1549), ...Array(12).fill(1799), 1999, 1999].map((c, i) => ({ postedOn: new Date(Date.UTC(2024, 8 + i, 15)).toISOString().slice(0, 10), cents: c }));
    expect(priceChangeOf(history)).toMatchObject({ fromCents: 1799, toCents: 1999 });
  });

  it("alerts once per new price, only for rises, only while it's news, and never with amounts", () => {
    const jar = { id: "j1", name: "Family" };
    const up = bill({ priceChange: { fromCents: 1599, toCents: 1799, sinceOn: "2026-09-01", confirmedOn: "2026-10-01" } });
    const a = priceUpAlert(jar, up, "2026-10-06");
    expect(a).toEqual({ kind: "MONEY_PRICE_UP", key: "price:netflix:2026-09-01", title: "📈 Netflix costs more than it used to (Family)", href: "/finances/j1/bills" });
    expect(a!.title).not.toMatch(/\$|\d+\.\d\d/);
    expect(priceUpAlert(jar, up, "2026-11-30")).toBeNull();
    expect(priceUpAlert(jar, bill({ priceChange: { fromCents: 1799, toCents: 1599, sinceOn: "2026-09-01", confirmedOn: "2026-10-01" } }), "2026-10-06")).toBeNull();
    // A quarterly rise is confirmed three months after it started: still news then.
    const quarterly = bill({ cadence: "QUARTERLY", isSubscription: false, priceChange: { fromCents: 9000, toCents: 9900, sinceOn: "2026-07-01", confirmedOn: "2026-10-01" } });
    expect(priceUpAlert(jar, quarterly, "2026-10-06")?.key).toBe("price:netflix:2026-07-01");
    expect(priceUpAlert(jar, { ...up, cadence: "WEEKLY", isSubscription: false }, "2026-10-06")).toBeNull();
  });
});

describe("history sentences", () => {
  it("reads saving-up changes", () => {
    expect(describeEvent("ROLLOVER_SET", { category: "School", on: true }, "Mom")).toBe("Mom started saving up leftovers in School");
    expect(describeEvent("GOAL_SET", { category: "School", cents: 40000, month: "2027-08" }, "Dad")).toBe("Dad set a goal for School: $400.00 by Aug 2027");
    expect(describeEvent("GOAL_SET", { category: "School", cents: null, month: null }, "Dad")).toBe("Dad took the goal off School");
  });
});
