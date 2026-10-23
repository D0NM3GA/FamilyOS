import { describe, expect, it } from "vitest";
import { findPaydays, forecast, type ForecastAccount, type ForecastRow } from "./forecast";
import { comingUp, findRecurring, type RowCategory } from "./recurring";
import { lowBalanceAlert } from "./alerts";
import type { CategoryKind } from "./categories";

/** Phase 32: Safe to spend (pure). */

const TODAY = "2026-10-06";
const cat = (key: string, kind: CategoryKind = "SPEND"): RowCategory => ({ key, absorbedKeys: [], kind });
const pay = (key: string, days: string[], cents = 250000, category: RowCategory | null = cat("income", "INCOME")) =>
  days.map((postedOn) => ({ key, label: key.toUpperCase(), postedOn, amountCents: cents, category }));

describe("paydays", () => {
  it("finds every two weeks", () => {
    const [p] = findPaydays(pay("acme payroll", ["2026-07-24", "2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"]), TODAY);
    expect(p).toMatchObject({ cadence: "BIWEEKLY", nextOn: "2026-10-16", typicalCents: 250000 });
  });

  it("finds the 1st and 15th, even when a weekend moves it to the Friday before", () => {
    // Aug 1 2026 is a Saturday: paid Fri Jul 31. Aug 15 is a Saturday: paid Fri Aug 14.
    const days = ["2026-07-01", "2026-07-15", "2026-07-31", "2026-08-14", "2026-09-01", "2026-09-15", "2026-10-01"];
    const [p] = findPaydays(pay("acme payroll", days), TODAY);
    expect(p).toMatchObject({ cadence: "SEMIMONTHLY", nextOn: "2026-10-15" });
  });

  it("doesn't think pay paid early for a weekend is due again tomorrow", () => {
    // The 1st of Nov 2026 is a Sunday: paid Fri Oct 30. Next is the 15th, not Nov 1.
    const days = ["2026-08-14", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-10-30"];
    const [p] = findPaydays(pay("acme payroll", days), "2026-11-04");
    expect(p).toMatchObject({ cadence: "SEMIMONTHLY", nextOn: "2026-11-15" });
  });

  it("needs two deposits on each day for the 1st and 15th, rather than guessing every two weeks", () => {
    expect(findPaydays(pay("acme payroll", ["2026-08-15", "2026-08-31", "2026-09-15"]), "2026-09-20")).toEqual([]);
  });

  it("keeps every two weeks when a bonus lands under the same name", () => {
    const days = ["2026-07-24", "2026-08-07", "2026-08-12", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"];
    expect(findPaydays(pay("acme payroll", days), TODAY)[0]).toMatchObject({ cadence: "BIWEEKLY", nextOn: "2026-10-16" });
    // The bonus is the latest deposit: still counted from the last regular one.
    expect(findPaydays(pay("acme payroll", ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-05"]), TODAY)[0]).toMatchObject({ nextOn: "2026-10-16" });
  });

  it("finds monthly pay on the same day, and the last day of the month", () => {
    expect(findPaydays(pay("pension", ["2026-07-03", "2026-08-03", "2026-09-03"]), "2026-10-01")[0]).toMatchObject({ cadence: "MONTHLY", nextOn: "2026-10-03" });
    // Late by 3 days: still today.
    expect(findPaydays(pay("pension", ["2026-07-03", "2026-08-03", "2026-09-03"]), "2026-10-06")[0].nextOn).toBe("2026-10-06");
    expect(findPaydays(pay("pension", ["2026-07-03", "2026-08-03", "2026-09-03"]), "2026-10-08")).toEqual([]);
    expect(findPaydays(pay("ssa", ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]), TODAY)[0]).toMatchObject({ nextOn: "2026-10-31" });
  });

  it("leaves out refunds, small deposits, too few, and money that isn't income or a transfer in", () => {
    expect(findPaydays(pay("acme", ["2026-09-04", "2026-09-18"]), TODAY)).toEqual([]);
    const rows = [
      ...pay("acme payroll", ["2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"]),
      ...pay("interest paid", ["2026-07-31", "2026-08-31", "2026-09-30"], 6000),
      ...pay("amazon", ["2026-08-21", "2026-09-04", "2026-09-18"], 30000),
      { key: "amazon", label: "AMAZON", postedOn: "2026-09-01", amountCents: -30000, category: null },
      ...pay("side gig", ["2026-08-21", "2026-09-04", "2026-09-18"], 30000, null),
      ...pay("online transfer from savings", ["2026-08-20", "2026-09-03", "2026-09-17", "2026-10-01"], 200000, cat("transfers", "TRANSFER")),
    ];
    expect(findPaydays(rows, TODAY).map((p) => p.key)).toEqual(["online transfer from savings", "acme payroll"]);
  });

  it("Phase 37: pay in an income category the family added counts too; spending never does", () => {
    const days = ["2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"];
    const sideGig = cat("side-gig-k3x9q2", "INCOME");
    expect(findPaydays(pay("acme payroll", days, 250000, sideGig), TODAY)[0]).toMatchObject({ key: "acme payroll", cadence: "BIWEEKLY", nextOn: "2026-10-16" });
    // A spending category that took in "income"'s key isn't a thing: income only moves into income.
    expect(findPaydays(pay("acme payroll", days, 250000, cat("other", "SPEND")), TODAY)).toEqual([]);
  });
});

const acct = (over: Partial<ForecastAccount> = {}): ForecastAccount => ({
  id: "chk",
  name: "Checking",
  spending: true,
  balanceCents: 300000,
  availableCents: 250000,
  balanceAt: new Date("2026-10-06T09:00:00Z"),
  ...over,
});
const out = (key: string, days: string[], cents: number, extra: Partial<ForecastRow> = {}): ForecastRow[] =>
  days.map((postedOn) => ({
    key,
    label: key.toUpperCase(),
    postedOn,
    amountCents: -cents,
    privacyCardToken: null,
    privacyCardMemo: null,
    category: null,
    accountId: "chk",
    ...extra,
  }));
const payRows = (accountId = "chk"): ForecastRow[] =>
  pay("acme payroll", ["2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"]).map((r) => ({ ...r, privacyCardToken: null, privacyCardMemo: null, accountId }));

describe("forecast", () => {
  it("needs a spending account with a balance", () => {
    expect(forecast({ accounts: [acct({ spending: false })], rows: [], statusOf: new Map(), today: TODAY, cushionCents: null })).toMatchObject({ ready: false, reason: "NO_ACCOUNTS" });
    expect(forecast({ accounts: [acct({ balanceCents: null, availableCents: null })], rows: [], statusOf: new Map(), today: TODAY, cushionCents: null })).toMatchObject({
      ready: false,
      reason: "NO_BALANCE",
    });
  });

  it("walks the regular bills on checking down to payday and finds the lowest point", () => {
    const rows = [
      ...payRows(),
      ...out("mortgage", ["2026-07-10", "2026-08-10", "2026-09-10"], 180000),
      ...out("electric", ["2026-07-08", "2026-08-07", "2026-09-08"], 12000),
      // Weekly: twice before payday (Oct 9, Oct 16 is payday: counted, money out first).
      ...out("kroger", ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"], 15000),
      // On a credit card, not checking: not counted.
      ...out("netflix", ["2026-07-15", "2026-08-15", "2026-09-15"], 1599, { accountId: "card" }),
      // After payday: not counted.
      ...out("insurance", ["2026-07-20", "2026-08-20", "2026-09-20"], 9000),
    ];
    const f = forecast({ accounts: [acct(), acct({ id: "card", name: "Visa", spending: false, availableCents: null, balanceCents: -50000 })], rows, statusOf: new Map(), today: TODAY, cushionCents: 20000 });
    if (!f.ready) throw new Error("not ready");
    expect(f.payday?.nextOn).toBe("2026-10-16");
    expect(f.startCents).toBe(250000);
    expect(f.events.map((e) => [e.on, e.label, e.cents])).toEqual([
      ["2026-10-08", "ELECTRIC", 12000],
      ["2026-10-09", "KROGER", 15000],
      ["2026-10-10", "MORTGAGE", 180000],
      ["2026-10-16", "KROGER", 15000],
    ]);
    expect(f.lowest).toEqual({ cents: 28000, on: "2026-10-16", after: "KROGER" });
    expect(f.safeCents).toBe(8000);
    expect(f.notCounted).toEqual(["Visa"]);
  });

  it("counts a late bill today unless about that much already left checking", () => {
    const base = [...payRows(), ...out("water", ["2026-07-04", "2026-08-04", "2026-09-04"], 5000)];
    const late = forecast({ accounts: [acct()], rows: base, statusOf: new Map(), today: TODAY, cushionCents: null });
    expect(late.ready && late.events.map((e) => [e.on, e.late])).toEqual([[TODAY, true]]);
    // A pending row whose text differs: same money, already in the available balance.
    const paid = forecast({ accounts: [acct()], rows: [...base, ...out("pos debit water dept", ["2026-10-05"], 5100, { pending: true })], statusOf: new Map(), today: TODAY, cushionCents: null });
    expect(paid.ready && paid.events).toEqual([]);
    // Due today, and its pending charge already landed under other words: not counted twice.
    const dueToday = [...payRows(), ...out("gas co", ["2026-07-06", "2026-08-06", "2026-09-06"], 8000)];
    expect(forecast({ accounts: [acct()], rows: dueToday, statusOf: new Map(), today: TODAY, cushionCents: null }).ready).toBe(true);
    const settled = forecast({ accounts: [acct()], rows: [...dueToday, ...out("pos gas company", [TODAY], 8000, { pending: true })], statusOf: new Map(), today: TODAY, cushionCents: null });
    expect(settled.ready && settled.events).toEqual([]);
    // Another regular bill of about the same size doesn't pay this one.
    const other = [...base, ...out("phone", ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], 5200)];
    const still = forecast({ accounts: [acct()], rows: other, statusOf: new Map(), today: TODAY, cushionCents: null });
    expect(still.ready && still.events.map((e) => e.label)).toEqual(["WATER"]);
  });

  it("counts card autopay at the most it's been lately, skips 'Not a bill', and looks 14 days ahead with no payday", () => {
    const rows = [
      ...out("chase card autopay", ["2026-07-12", "2026-08-12", "2026-09-12"], 0, { category: cat("transfers", "TRANSFER") }).map((r, i) => ({ ...r, amountCents: -[40000, 90000, 60000][i] })),
      ...out("gym", ["2026-07-09", "2026-08-09", "2026-09-09"], 4000),
    ];
    const f = forecast({ accounts: [acct()], rows, statusOf: new Map([["gym", "HIDDEN"]]), today: TODAY, cushionCents: null });
    if (!f.ready) throw new Error("not ready");
    expect(f.payday).toBeNull();
    expect(f.until).toBe("2026-10-20");
    expect(f.events.map((e) => [e.label, e.cents, e.varies])).toEqual([["CHASE CARD AUTOPAY", 90000, true]]);
    // Bills (no transfers option) never sees the autopay.
    expect(findRecurring(rows, TODAY).map((r) => r.key)).toEqual(["gym"]);
  });
});

describe("low-balance alert", () => {
  const jar = { id: "j1", name: "Family" };
  const now = new Date("2026-10-06T12:00:00Z");
  const tight = () => {
    const f = forecast({ accounts: [acct({ availableCents: 100000 })], rows: [...payRows(), ...out("mortgage", ["2026-07-10", "2026-08-10", "2026-09-10"], 180000)], statusOf: new Map(), today: TODAY, cushionCents: null });
    if (!f.ready) throw new Error("not ready");
    return f;
  };

  it("warns once per pay period, without amounts", () => {
    const a = lowBalanceAlert(jar, tight(), now, false);
    expect(a).toEqual({ kind: "MONEY_LOW_BALANCE", key: "low:2026-10-02", title: "⚠️ Family may run low before payday (around Oct 10)", href: "/finances/j1/bills" });
    expect(a!.title).not.toMatch(/\$|\d+\.\d\d/);
  });

  it("keeps one key while payday runs a day or two late", () => {
    const keys = ["2026-10-16", "2026-10-17", "2026-10-18"].map((day) => {
      const f = forecast({ accounts: [acct({ availableCents: 1000, balanceAt: new Date(`${day}T09:00:00Z`) })], rows: [...payRows(), ...out("mortgage", ["2026-08-17", "2026-09-17"], 1, { amountCents: -500 } as never)], statusOf: new Map(), today: day, cushionCents: 5000 });
      if (!f.ready) throw new Error("not ready");
      return lowBalanceAlert(jar, f, new Date(`${day}T12:00:00Z`), false)?.key;
    });
    expect(new Set(keys)).toEqual(new Set(["low:2026-10-02"]));
  });

  it("stays quiet with no payday, a stale balance, a broken feed, or enough money", () => {
    const f = tight();
    expect(lowBalanceAlert(jar, { ...f, payday: null }, now, false)).toBeNull();
    expect(lowBalanceAlert(jar, f, new Date("2026-10-09T12:00:00Z"), false)).toBeNull();
    expect(lowBalanceAlert(jar, f, now, true)).toBeNull();
    expect(lowBalanceAlert(jar, { ...f, lowest: { ...f.lowest, cents: 5000 } }, now, false)).toBeNull();
    expect(lowBalanceAlert(jar, { ...f, lowest: { ...f.lowest, cents: 5000 }, cushionCents: 10000 }, now, false)).not.toBeNull();
  });
});

describe("a bill whose price went up", () => {
  // Netflix: $15.99 from March to July, then $17.99 in August and September.
  const netflix = out("netflix", ["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"], 1599, { category: cat("subscriptions") }).concat(
    out("netflix", ["2026-08-15", "2026-09-15"], 1799, { category: cat("subscriptions") }),
  );

  it("is shown and added up at the new price once the change has settled", () => {
    const [bill] = findRecurring(netflix, TODAY);
    expect(bill.priceChange).toMatchObject({ fromCents: 1599, toCents: 1799 });
    expect(bill).toMatchObject({ typicalCents: 1799, steady: true, nextOn: "2026-10-15" });
    expect(comingUp([bill], new Map(), TODAY).totalCents).toBe(1799);
  });

  it("is planned at the new price in Safe to spend", () => {
    const f = forecast({ accounts: [acct()], rows: [...payRows(), ...netflix], statusOf: new Map(), today: TODAY, cushionCents: null });
    if (!f.ready) throw new Error("not ready");
    expect(f.events.filter((e) => e.label === "NETFLIX").map((e) => e.cents)).toEqual([1799]);
  });

  it("keeps the whole history's usual amount when nothing has settled (one odd charge)", () => {
    const odd = out("netflix", ["2026-06-15", "2026-07-15", "2026-08-15"], 1599, { category: cat("subscriptions") }).concat(out("netflix", ["2026-09-15"], 1799, { category: cat("subscriptions") }));
    const [bill] = findRecurring(odd, TODAY);
    expect(bill.priceChange).toBeNull();
    expect(bill.typicalCents).toBe(1599);
  });
});
