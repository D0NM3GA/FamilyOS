import { describe, expect, it } from "vitest";
import { lockLabel, lockoutMs } from "./pin-lockout";

const MIN = 60_000;

describe("PIN lockout", () => {
  it("doubles each lock, from 15 minutes up to a day", () => {
    expect(lockoutMs(1)).toBe(15 * MIN);
    expect(lockoutMs(2)).toBe(30 * MIN);
    expect(lockoutMs(3)).toBe(60 * MIN);
    expect(lockoutMs(7)).toBe(16 * 60 * MIN);
    expect(lockoutMs(8)).toBe(24 * 60 * MIN);
    expect(lockoutMs(100)).toBe(24 * 60 * MIN);
  });

  it("treats a bad lock number as the first lock", () => {
    expect(lockoutMs(0)).toBe(15 * MIN);
    expect(lockoutMs(-3)).toBe(15 * MIN);
  });

  it("says how long in words, rounding up", () => {
    expect(lockLabel(15 * MIN)).toBe("15 minutes");
    expect(lockLabel(30_000)).toBe("1 minute");
    expect(lockLabel(61 * MIN)).toBe("2 hours");
    expect(lockLabel(60 * MIN)).toBe("1 hour");
    expect(lockLabel(24 * 60 * MIN)).toBe("a day");
  });
});
