import { describe, expect, it } from "vitest";
import { billDaysOf } from "./calendar-bills";
import type { Recurring } from "./recurring";
import type { ManualBillInput } from "./manual-bills";

const found = (over: Partial<Recurring>): Recurring =>
  ({ key: "water", merchantKey: "water", label: "City water", cadence: "MONTHLY", nextOn: "2027-01-31", stopped: false, isSubscription: false, ...over }) as Recurring;
const manual = (over: Partial<ManualBillInput>): ManualBillInput => ({ id: "m1", name: "Swim club", amountCents: 9000, cadence: "MONTHLY", nextDue: "2027-01-10", matchKey: "", ...over });

describe("bill days for the calendar (Phase 63b)", () => {
  it("steps a monthly bill by whole months, the 31st clamping in February", () => {
    expect(billDaysOf([found({})], [], new Set(), "2027-01-01", "2027-03-31").map((b) => b.day)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("shows a found bill once when a hand-added one stands for it, and skips hidden ones", () => {
    const stands = manual({ name: "Water bill", matchKey: "water", nextDue: "2027-01-31" });
    expect(billDaysOf([found({})], [stands], new Set(), "2027-01-01", "2027-01-31").map((b) => b.name)).toEqual(["Water bill"]);
    expect(billDaysOf([found({})], [], new Set(["water"]), "2027-01-01", "2027-01-31")).toEqual([]);
  });

  it("a weekly subscription shows its next day only", () => {
    const weekly = found({ key: "app", label: "App", cadence: "WEEKLY", nextOn: "2027-01-05", isSubscription: true });
    expect(billDaysOf([weekly], [], new Set(), "2027-01-01", "2027-01-31").map((b) => b.day)).toEqual(["2027-01-05"]);
  });
});
