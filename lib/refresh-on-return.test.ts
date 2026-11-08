import { describe, expect, it } from "vitest";
import { AWAY_MS, shouldRefresh } from "@/components/refresh-on-return";

describe("shouldRefresh (Phase 69a)", () => {
  const now = new Date(2026, 10, 8, 9, 0);
  const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  it("after a minute away, or on a new day, and only online", () => {
    expect(shouldRefresh({ hiddenAt: now.getTime() - AWAY_MS, freshDay: today, now, online: true })).toBe(true);
    expect(shouldRefresh({ hiddenAt: now.getTime() - 5_000, freshDay: today, now, online: true })).toBe(false);
    expect(shouldRefresh({ hiddenAt: null, freshDay: "2026-10-7", now, online: true })).toBe(true);
    expect(shouldRefresh({ hiddenAt: null, freshDay: today, now, online: true })).toBe(false);
    expect(shouldRefresh({ hiddenAt: now.getTime() - AWAY_MS * 10, freshDay: today, now, online: false })).toBe(false);
  });
});
