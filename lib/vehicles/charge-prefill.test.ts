import { describe, expect, it } from "vitest";
import { parseChargePrefill } from "./charge-prefill";

describe("a Money charge sent to Cars", () => {
  it("reads a fill-up or a service, cost in dollars", () => {
    expect(parseChargePrefill({ fuel: "4512", on: "2026-11-05" }, "2026-11-07")).toEqual({ kind: "fuel", cost: "45.12", date: "2026-11-05" });
    expect(parseChargePrefill({ service: "8999", on: "2026-11-07" }, "2026-11-07")).toEqual({ kind: "service", cost: "89.99", date: "2026-11-07" });
  });

  it("ignores anything odd", () => {
    for (const p of [{ fuel: "-5", on: "2026-11-05" }, { fuel: "1e3", on: "2026-11-05" }, { fuel: "100000001", on: "2026-11-05" }, { fuel: "100", on: "2026-02-30" }, { fuel: "100", on: "2026-12-01" }, { fuel: "100" }, {}]) {
      expect(parseChargePrefill(p, "2026-11-07")).toBeNull();
    }
  });
});
