import { describe, expect, it } from "vitest";
import { anchorForEdit, billsAhead, dueDays, nameKey, nextDueOn, parseManualBillForm, standsFor, type ManualBillInput } from "./manual-bills";
import { findRecurring, paidCheck, type RecurringRow, type RowCategory } from "./recurring";
import { forecast, type ForecastAccount, type ForecastRow } from "./forecast";
import { manualBillAlert } from "./alerts";
import type { CategoryKind } from "./categories";

const cat = (key: string, kind: CategoryKind = "SPEND"): RowCategory => ({ key, absorbedKeys: [], kind });

/** Bills added by hand: their due days, and counted once in Coming up and Safe to spend. */

const TODAY = "2026-10-06";
const bill = (over: Partial<ManualBillInput> = {}): ManualBillInput => ({
  id: "b1",
  name: "School fees",
  amountCents: 30000,
  cadence: "MONTHLY",
  nextDue: "2026-10-12",
  matchKey: "school fees",
  ...over,
});
const out = (key: string, days: string[], cents: number, extra: Partial<ForecastRow> = {}): ForecastRow[] =>
  days.map((postedOn) => ({ key, label: key.toUpperCase(), postedOn, amountCents: -cents, privacyCardToken: null, privacyCardMemo: null, category: null, accountId: "chk", ...extra }));
const netflixRows = out("netflix", ["2026-07-15", "2026-08-15", "2026-09-15"], 1599, { category: cat("subscriptions") });
const waterRows = out("water", ["2026-07-04", "2026-08-04", "2026-09-04"], 5000);

describe("due days", () => {
  it("keeps a bill on the 31st on the 31st after a short month", () => {
    expect(dueDays(bill({ nextDue: "2026-01-31" }), "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("steps quarterly and yearly from a first day long ago", () => {
    expect(dueDays(bill({ cadence: "QUARTERLY", nextDue: "2024-11-15" }), "2026-10-01", "2027-06-01")).toEqual(["2026-11-15", "2027-02-15", "2027-05-15"]);
    expect(dueDays(bill({ cadence: "YEARLY", nextDue: "2025-03-01" }), "2026-01-01", "2027-12-31")).toEqual(["2026-03-01", "2027-03-01"]);
  });
  it("starts no earlier than the first due day", () => {
    expect(dueDays(bill({ nextDue: "2026-12-05" }), "2026-10-01", "2027-01-31")).toEqual(["2026-12-05", "2027-01-05"]);
  });
  it("has one day for a one-off bill", () => {
    expect(dueDays(bill({ cadence: "ONCE", nextDue: "2026-10-20" }), TODAY, "2026-11-01")).toEqual(["2026-10-20"]);
    expect(dueDays(bill({ cadence: "ONCE", nextDue: "2026-10-20" }), "2026-10-21", "2026-11-01")).toEqual([]);
  });
});

describe("next due", () => {
  it("is a few days late until it's paid", () => {
    const rent = bill({ nextDue: "2026-09-04" });
    expect(nextDueOn(rent, TODAY)).toBe("2026-10-04");
    expect(nextDueOn(rent, TODAY, (d) => d === "2026-10-04")).toBe("2026-11-04");
    // Too late to still be "coming up": the next one.
    expect(nextDueOn(bill({ nextDue: "2026-09-01" }), TODAY)).toBe("2026-11-01");
  });
  it("is gone for a one-off bill that's been paid or has passed", () => {
    expect(nextDueOn(bill({ cadence: "ONCE", nextDue: "2026-10-20" }), TODAY)).toBe("2026-10-20");
    expect(nextDueOn(bill({ cadence: "ONCE", nextDue: "2026-09-20" }), TODAY)).toBeNull();
    expect(nextDueOn(bill({ cadence: "ONCE", nextDue: "2026-10-05" }), TODAY, () => true)).toBeNull();
  });
});

describe("Coming up with bills added by hand", () => {
  const found = findRecurring([...netflixRows, ...waterRows], TODAY);

  it("adds them with a marker, in the total, and never counts a bill twice", () => {
    const manual = [
      bill({ id: "car", name: "Car registration", cadence: "YEARLY", nextDue: "2025-10-20", amountCents: 25000, matchKey: nameKey("Car registration") }),
      // Too far off for the next 30 days.
      bill({ id: "school", cadence: "QUARTERLY", nextDue: "2026-08-20" }),
      // Typed by hand with the found bill's name: it stands for it.
      bill({ id: "nf", name: "Netflix", nextDue: "2026-10-14", amountCents: 1799, matchKey: nameKey("Netflix") }),
    ];
    const ahead = billsAhead(found, manual, new Map(), TODAY);
    expect(ahead.items.map((i) => [i.key, i.nextOn, i.manualId])).toEqual([
      ["water", "2026-10-04", null],
      ["manual:nf", "2026-10-14", "nf"],
      ["manual:car", "2026-10-20", "car"],
    ]);
    expect(ahead.totalCents).toBe(5000 + 1799 + 25000);
  });

  it("stands for a found bill picked by its key, whatever its name", () => {
    const manual = [bill({ id: "w", name: "City water", nextDue: "2026-10-20", amountCents: 5200, matchKey: "water" })];
    expect(standsFor(manual, found)).toEqual(new Set(["water"]));
    expect(billsAhead(found, manual, new Map(), TODAY).items.map((i) => i.key)).toEqual(["netflix", "manual:w"]);
  });

  it("moves on once a check of about its size has gone out", () => {
    const rent = [bill({ id: "rent", name: "Rent", nextDue: "2026-09-04", amountCents: 150000, matchKey: "rent" })];
    const late = billsAhead([], rent, new Map(), TODAY);
    expect(late.items.map((i) => i.nextOn)).toEqual(["2026-10-04"]);
    const rows: RecurringRow[] = out("check", ["2026-10-04"], 150000);
    const paid = billsAhead([], rent, new Map(), TODAY, 30, paidCheck(rows, new Set(), TODAY));
    expect(paid.items.map((i) => i.nextOn)).toEqual(["2026-11-04"]);
  });

  it("a one-off purchase of about its size doesn't pay it", () => {
    const rent = [bill({ id: "rent", name: "Rent", nextDue: "2026-09-04", amountCents: 150000, matchKey: "rent" })];
    const rows: RecurringRow[] = out("the home depot", ["2026-10-04"], 140000);
    const still = billsAhead([], rent, new Map(), TODAY, 30, paidCheck(rows, new Set(), TODAY));
    expect(still.items.map((i) => i.nextOn)).toEqual(["2026-10-04"]);
    // Its own merchant does.
    const own = billsAhead([], rent, new Map(), TODAY, 30, paidCheck(out("rent", ["2026-10-04"], 150000), new Set(), TODAY));
    expect(own.items.map((i) => i.nextOn)).toEqual(["2026-11-04"]);
  });
});

describe("Safe to spend with bills added by hand", () => {
  const acct: ForecastAccount = { id: "chk", name: "Checking", spending: true, balanceCents: 300000, availableCents: 250000, balanceAt: new Date("2026-10-06T09:00:00Z") };
  const payRows: ForecastRow[] = ["2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"].map((postedOn) => ({
    key: "acme payroll",
    label: "ACME PAYROLL",
    postedOn,
    amountCents: 250000,
    privacyCardToken: null,
    privacyCardMemo: null,
    category: cat("income", "INCOME"),
    accountId: "chk",
  }));
  const run = (rows: ForecastRow[], manualBills: ManualBillInput[]) => {
    const f = forecast({ accounts: [acct], rows: [...payRows, ...rows], statusOf: new Map(), today: TODAY, cushionCents: null, manualBills });
    if (!f.ready) throw new Error("not ready");
    return f;
  };

  it("plans them before payday, once, in place of a found bill they stand for", () => {
    const netflixOnChecking = out("netflix", ["2026-07-14", "2026-08-14", "2026-09-14"], 1599);
    const f = run(netflixOnChecking, [
      bill({ id: "fees", cadence: "ONCE", nextDue: "2026-10-12" }),
      bill({ id: "nf", name: "Netflix", nextDue: "2026-10-14", amountCents: 1799, matchKey: "netflix" }),
      // After payday (Oct 16): not in this pay period.
      bill({ id: "car", name: "Car registration", cadence: "YEARLY", nextDue: "2025-10-30", amountCents: 25000, matchKey: "car registration" }),
    ]);
    expect(f.payday?.nextOn).toBe("2026-10-16");
    expect(f.events.map((e) => [e.on, e.label, e.cents, e.manual])).toEqual([
      ["2026-10-12", "School fees", 30000, true],
      ["2026-10-14", "Netflix", 1799, true],
    ]);
    expect(f.lowest.cents).toBe(250000 - 30000 - 1799);
  });

  it("counts a late one today unless a check of about that size already went out", () => {
    const rent = [bill({ id: "rent", name: "Rent", nextDue: "2026-09-05", amountCents: 150000, matchKey: "rent" })];
    expect(run([], rent).events.map((e) => [e.on, e.late])).toEqual([[TODAY, true]]);
    expect(run(out("check 1234", ["2026-10-05"], 150000), rent).events).toEqual([]);
    // Another regular bill's charge of about that size doesn't pay it.
    const phone = out("phone", ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], 148000);
    expect(run(phone, rent).events.map((e) => e.label)).toEqual(["Rent"]);
  });
});

describe("the add-a-bill form", () => {
  const form = (over: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "School fees", amount: "$1,200.50", cadence: "QUARTERLY", nextDue: "2026-11-20", ...over })) f.set(k, v);
    return f;
  };

  it("reads a bill, standing for its own name's merchant unless one is picked", () => {
    expect(parseManualBillForm(form(), TODAY)).toEqual({
      ok: true,
      bill: { name: "School fees", amountCents: 120050, cadence: "QUARTERLY", nextDue: "2026-11-20", matchKey: "school fees" },
    });
    const picked = parseManualBillForm(form({ matchKey: "privacy:card-1" }), TODAY);
    expect(picked.ok && picked.bill.matchKey).toBe("privacy:card-1");
  });

  it.each([
    [{ name: "  " }, "Give the bill a name."],
    [{ amount: "lots" }, "Use a dollar amount, like 120 or 120.50."],
    [{ amount: "0" }, "How much is it?"],
    [{ cadence: "WEEKLY" }, "Pick how often it comes."],
    [{ nextDue: "2026-02-30" }, "Pick the day it's due."],
    [{ nextDue: "2025-01-01" }, "Pick a due day within the last year, or the next one."],
    [{ nextDue: "2032-01-01" }, "Pick a due day within five years."],
    [{ cadence: "ONCE", nextDue: "2026-09-01" }, "That day has passed. Pick when it's due."],
  ])("refuses %o", (over, error) => {
    expect(parseManualBillForm(form(over), TODAY)).toEqual({ ok: false, error });
  });

  it("editing a finished one-off keeps its day (only a new past day is refused)", () => {
    const done = form({ cadence: "ONCE", nextDue: "2026-09-01" });
    expect(parseManualBillForm(done, TODAY, { keepDay: "2026-09-01" }).ok).toBe(true);
    expect(parseManualBillForm(done, TODAY, { keepDay: "2026-08-15" }).ok).toBe(false);
  });
});

describe("editing keeps a bill's first due day", () => {
  it("a bill on the 31st shown as Feb 28 stays on the 31st", () => {
    const stored = { cadence: "MONTHLY" as const, nextDue: "2026-01-31" };
    expect(anchorForEdit(stored, { cadence: "MONTHLY", nextDue: "2026-02-28" })).toBe("2026-01-31");
    expect(dueDays(stored, "2026-03-01", "2026-04-30")).toEqual(["2026-03-31", "2026-04-30"]);
  });
  it("a new day off the schedule, or a new cadence, becomes the new first day", () => {
    const stored = { cadence: "MONTHLY" as const, nextDue: "2026-01-31" };
    expect(anchorForEdit(stored, { cadence: "MONTHLY", nextDue: "2026-02-15" })).toBe("2026-02-15");
    expect(anchorForEdit(stored, { cadence: "QUARTERLY", nextDue: "2026-02-28" })).toBe("2026-02-28");
  });
});

describe("bill alerts for bills added by hand", () => {
  const jar = { id: "j1", name: "Family" };
  it("comes in the 3 days before, once per due day, without an amount", () => {
    const a = manualBillAlert(jar, bill(), "2026-10-09", TODAY);
    expect(a).toEqual({ kind: "MONEY_BILL_DUE", key: "bill:manual:b1:2026-10-09", title: "🧾 School fees is due Oct 9 (Family)", href: "/finances/j1/bills" });
    expect(manualBillAlert(jar, bill(), TODAY, TODAY)).not.toBeNull();
    expect(manualBillAlert(jar, bill(), "2026-10-10", TODAY)).toBeNull();
    expect(manualBillAlert(jar, bill(), "2026-10-05", TODAY)).toBeNull();
    expect(manualBillAlert(jar, bill(), null, TODAY)).toBeNull();
  });
});
