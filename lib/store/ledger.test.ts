import { describe, expect, it } from "vitest";
import { describeLedgerRow } from "./ledger";

const row = (over: Partial<Parameters<typeof describeLedgerRow>[0]>) => ({
  id: "r1",
  delta: 3,
  reason: "Empty the dishwasher",
  createdAt: new Date(2026, 9, 9),
  orderId: null,
  instance: null,
  ...over,
});

describe("describeLedgerRow", () => {
  it("names chores, meds, store orders and refunds", () => {
    expect(describeLedgerRow(row({ instance: { definition: { domain: "CHORE" } } })).kind).toBe("chore");
    expect(describeLedgerRow(row({ instance: { definition: { domain: "MED" } } })).kind).toBe("med");
    expect(describeLedgerRow(row({ orderId: "o1", delta: -150 })).kind).toBe("order");
    expect(describeLedgerRow(row({ orderId: "o1", delta: 150 })).kind).toBe("refund");
  });
  it("a grown-up's bonus or take-back has no chore or order", () => {
    expect(describeLedgerRow(row({ delta: 10, reason: "Helped Grandma" }))).toMatchObject({ kind: "bonus", label: "Helped Grandma" });
    expect(describeLedgerRow(row({ delta: -5, reason: "  " }))).toMatchObject({ kind: "taken", label: "Stickers" });
  });
});
