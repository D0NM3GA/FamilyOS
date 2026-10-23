import { describe, expect, it } from "vitest";
import { accountNow, accountStale, ageWords, holdingStale, monthEnd, netWorthMonths, valueOn, worthWindow, type WorthAccount, type WorthHolding } from "./net-worth";
import { parseHoldingForm, parseValueForm } from "./holdings";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("valueOn and month ends", () => {
  const points = [
    { day: "2026-01-10", cents: 100 },
    { day: "2026-03-01", cents: 300 },
  ];
  it("takes the newest point on or before the day, else nothing", () => {
    expect(valueOn(points, "2026-01-09")).toBeNull();
    expect(valueOn(points, "2026-01-10")).toBe(100);
    expect(valueOn(points, "2026-02-28")).toBe(100);
    expect(valueOn(points, "2026-12-31")).toBe(300);
  });
  it("knows each month's last day, leap years included", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });
  it("looks at 13 months: twelve bars and the month a year ago", () => {
    const w = worthWindow("2026-10-09");
    expect(w).toHaveLength(13);
    expect([w[0], w[12]]).toEqual(["2025-10", "2026-10"]);
  });
});

describe("netWorthMonths", () => {
  const today = "2026-10-09";
  const months = worthWindow(today);
  const checking = (over: Partial<WorthAccount> = {}): WorthAccount => ({
    id: "chk",
    nowCents: 500_000,
    days: [
      { day: "2026-08-15", cents: 300_000 },
      { day: "2026-09-30", cents: 400_000 },
    ],
    ...over,
  });
  // SimpleFIN sends what's owed on a card as a negative balance.
  const card: WorthAccount = { id: "visa", nowCents: -150_000, days: [{ day: "2026-09-20", cents: -100_000 }] };

  it("is empty with nothing at all", () => {
    expect(netWorthMonths([], [], months, today)).toEqual([]);
    expect(netWorthMonths([{ id: "x", nowCents: null, days: [] }], [], months, today)).toEqual([]);
  });

  it("starts at the first month with anything in it and splits have from owe by sign", () => {
    const out = netWorthMonths([checking(), card], [], months, today);
    expect(out.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(out[0]).toEqual({ month: "2026-08", haveCents: 300_000, oweCents: 0, netCents: 300_000, partial: true });
    expect(out[1]).toEqual({ month: "2026-09", haveCents: 400_000, oweCents: 100_000, netCents: 300_000, partial: false });
  });

  it("uses the balance now for the current month, so the bar matches the big number", () => {
    const out = netWorthMonths([checking(), card], [], months, today);
    expect(out.at(-1)).toEqual({ month: "2026-10", haveCents: 500_000, oweCents: 150_000, netCents: 350_000, partial: false });
    // A feed that never kept a day still counts now.
    expect(netWorthMonths([checking({ days: [] })], [], months, today)).toEqual([{ month: "2026-10", haveCents: 500_000, oweCents: 0, netCents: 500_000, partial: false }]);
  });

  it("carries a holding's first value back to the start, and counts a loan as owed", () => {
    const house: WorthHolding = { id: "h", kind: "HOME", values: [{ day: "2026-10-01", cents: 40_000_000 }] };
    const loan: WorthHolding = {
      id: "l",
      kind: "LOAN",
      values: [
        { day: "2026-09-01", cents: 2_000_000 },
        { day: "2026-10-01", cents: 1_900_000 },
      ],
    };
    const out = netWorthMonths([checking()], [house, loan], months, today);
    expect(out[0]).toEqual({ month: "2026-08", haveCents: 300_000 + 40_000_000, oweCents: 2_000_000, netCents: 38_300_000, partial: false });
    expect(out.at(-1)).toEqual({ month: "2026-10", haveCents: 500_000 + 40_000_000, oweCents: 1_900_000, netCents: 38_600_000, partial: false });
  });

  it("a holding valued years ago starts the bars at the window's start, not before", () => {
    const house: WorthHolding = { id: "h", kind: "HOME", values: [{ day: "2019-06-01", cents: 30_000_000 }] };
    const out = netWorthMonths([], [house], months, today);
    expect(out.map((m) => m.month)).toEqual(months);
    expect(out.every((m) => m.netCents === 30_000_000)).toBe(true);
  });

  it("an account counts only from its first day; a later one doesn't reach back", () => {
    const late: WorthAccount = { id: "new", nowCents: 10_000, days: [{ day: "2026-09-25", cents: 10_000 }] };
    const out = netWorthMonths([checking(), late], [], months, today);
    expect(out[0]).toMatchObject({ haveCents: 300_000, partial: true });
    expect(out[1]).toMatchObject({ haveCents: 410_000, partial: false });
    // A closed account (no balance now) doesn't make a month partial.
    const closed: WorthAccount = { id: "old", nowCents: null, days: [{ day: "2026-09-01", cents: 5 }] };
    expect(netWorthMonths([checking(), closed], [], months, today)[0].partial).toBe(false);
  });
});

describe("accountNow", () => {
  const days = [
    { day: "2026-10-01", cents: 100 },
    { day: "2026-10-08", cents: 200 },
  ];
  it("the bank's balance when there is one; the last kept one when a sync came back without", () => {
    expect(accountNow(300, "2026-10-09", days)).toEqual({ cents: 300, seen: "2026-10-09" });
    expect(accountNow(null, null, days)).toEqual({ cents: 200, seen: "2026-10-08" });
    expect(accountNow(null, null, [])).toEqual({ cents: null, seen: null });
  });
  it("seen is the newer of the bank's day and the last kept day (a quiet account still syncing isn't stale)", () => {
    expect(accountNow(300, "2026-07-01", days).seen).toBe("2026-10-08");
  });
});

describe("stale nudges", () => {
  it("a home or car after about six months, a loan after three, an account after 45 days", () => {
    expect(holdingStale("HOME", "2026-05-01", "2026-10-09")).toBeNull();
    expect(holdingStale("HOME", "2026-03-01", "2026-10-09")).toBe(222);
    expect(holdingStale("LOAN", "2026-06-01", "2026-10-09")).toBe(130);
    expect(holdingStale("LOAN", "2026-08-01", "2026-10-09")).toBeNull();
    expect(accountStale("2026-08-01", "2026-10-09")).toBe(69);
    expect(accountStale("2026-09-30", "2026-10-09")).toBeNull();
    expect(accountStale(null, "2026-10-09")).toBeNull();
  });
  it("says how long ago in words", () => {
    expect(ageWords(1)).toBe("yesterday");
    expect(ageWords(10)).toBe("10 days ago");
    expect(ageWords(21)).toBe("3 weeks ago");
    expect(ageWords(222)).toBe("7 months ago");
    expect(ageWords(800)).toBe("2 years ago");
  });
});

describe("the holding forms", () => {
  const today = "2026-10-09";
  it("takes a house worth more than the usual $1M cap, dated in the past", () => {
    expect(parseHoldingForm(form({ name: " Our house ", kind: "HOME", value: "$1,250,000", valuedOn: "2019-06-01" }), today)).toEqual({
      ok: true,
      holding: { name: "Our house", kind: "HOME", valueCents: 125_000_000, valuedOn: "2019-06-01" },
    });
  });
  it("lets a loan be paid off (0) but not be blank", () => {
    expect(parseValueForm(form({ value: "0", valuedOn: today }), today)).toEqual({ ok: true, value: { valueCents: 0, valuedOn: today } });
    expect(parseValueForm(form({ value: "", valuedOn: today }), today)).toMatchObject({ ok: false });
  });
  it("refuses a future day, a day before 1950, a made-up day, a kind it doesn't know, and over $20M", () => {
    expect(parseValueForm(form({ value: "1", valuedOn: "2026-10-10" }), today)).toMatchObject({ ok: false, error: "Pick today or a day that's passed." });
    expect(parseValueForm(form({ value: "1", valuedOn: "1949-12-31" }), today)).toMatchObject({ ok: false });
    expect(parseValueForm(form({ value: "1", valuedOn: "2026-02-30" }), today)).toMatchObject({ ok: false });
    expect(parseHoldingForm(form({ name: "Boat", kind: "BOAT", value: "1", valuedOn: today }), today)).toMatchObject({ ok: false });
    expect(parseValueForm(form({ value: "20000000.01", valuedOn: today }), today)).toMatchObject({ ok: false, error: "That's more than $20 million. Check the amount." });
    expect(parseValueForm(form({ value: "-5", valuedOn: today }), today)).toMatchObject({ ok: false });
  });
});
