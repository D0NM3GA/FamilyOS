import { describe, expect, test } from "vitest";
import { computeDueStatus, UPCOMING_MILES_BAND, UPCOMING_DAYS_BAND, type MaintenanceItemLike } from "./due-status";

function item(overrides: Partial<MaintenanceItemLike>): MaintenanceItemLike {
  return {
    intervalMiles: null,
    intervalMonths: null,
    lastDoneMileage: null,
    lastDoneAt: null,
    ...overrides,
  };
}

const today = new Date(2026, 5, 15);

describe("computeDueStatus — never serviced", () => {
  test("is OVERDUE with no thresholds computed, regardless of configured intervals", () => {
    const result = computeDueStatus(
      item({ intervalMiles: 5000, intervalMonths: 6 }),
      50_000,
      today,
    );
    expect(result).toEqual({
      status: "OVERDUE",
      dueByMileage: null,
      dueByDate: null,
      milesRemaining: null,
      daysRemaining: null,
    });
  });
});

describe("computeDueStatus — mileage axis only", () => {
  const base = item({ intervalMiles: 5000, lastDoneMileage: 40_000 });

  test("OK well before the threshold", () => {
    expect(computeDueStatus(base, 40_000, today).status).toBe("OK");
  });

  test("UPCOMING inside the band", () => {
    const result = computeDueStatus(base, 45_000 - UPCOMING_MILES_BAND, today);
    expect(result.status).toBe("UPCOMING");
    expect(result.milesRemaining).toBe(UPCOMING_MILES_BAND);
  });

  test("OVERDUE exactly at the threshold", () => {
    const result = computeDueStatus(base, 45_000, today);
    expect(result.status).toBe("OVERDUE");
    expect(result.milesRemaining).toBe(0);
  });

  test("OVERDUE past the threshold", () => {
    expect(computeDueStatus(base, 46_000, today).status).toBe("OVERDUE");
  });

  test("date axis stays null — no date interval configured", () => {
    const result = computeDueStatus(base, 40_000, today);
    expect(result.dueByDate).toBeNull();
    expect(result.daysRemaining).toBeNull();
  });
});

describe("computeDueStatus — date axis only", () => {
  const base = item({ intervalMonths: 6, lastDoneAt: new Date(2026, 0, 15) });

  test("OK well before the threshold", () => {
    expect(computeDueStatus(base, 0, new Date(2026, 1, 1)).status).toBe("OK");
  });

  test("UPCOMING inside the band", () => {
    // Due 2026-07-15; within UPCOMING_DAYS_BAND (30) means on/after 2026-06-15.
    const result = computeDueStatus(base, 0, new Date(2026, 5, 15));
    expect(result.status).toBe("UPCOMING");
    expect(result.daysRemaining).toBe(30);
  });

  test("OVERDUE exactly at the threshold", () => {
    const result = computeDueStatus(base, 0, new Date(2026, 6, 15));
    expect(result.status).toBe("OVERDUE");
    expect(result.daysRemaining).toBe(0);
  });

  test("mileage axis stays null — no mileage interval configured", () => {
    const result = computeDueStatus(base, 999_999, new Date(2026, 1, 1));
    expect(result.dueByMileage).toBeNull();
    expect(result.milesRemaining).toBeNull();
  });

  test("clamps month-end anchors the same way addMonths does (Jan 31 + 1mo)", () => {
    const janEnd = item({ intervalMonths: 1, lastDoneAt: new Date(2026, 0, 31) });
    // 2026 is not a leap year, so +1 month from Jan 31 clamps to Feb 28.
    expect(computeDueStatus(janEnd, 0, new Date(2026, 1, 28)).status).toBe("OVERDUE");
    expect(computeDueStatus(janEnd, 0, new Date(2026, 1, 27)).status).toBe("UPCOMING");
  });
});

describe("computeDueStatus — whichever comes first", () => {
  const base = item({
    intervalMiles: 5000,
    intervalMonths: 6,
    lastDoneMileage: 40_000,
    lastDoneAt: new Date(2026, 0, 15),
  });

  test("OVERDUE by mileage alone, even though the date axis is still OK", () => {
    const result = computeDueStatus(base, 45_000, new Date(2026, 1, 1));
    expect(result.status).toBe("OVERDUE");
    expect(result.milesRemaining).toBe(0);
    expect(result.daysRemaining).toBeGreaterThan(UPCOMING_DAYS_BAND);
  });

  test("OVERDUE by date alone, even though the mileage axis is still OK", () => {
    const result = computeDueStatus(base, 41_000, new Date(2026, 6, 15));
    expect(result.status).toBe("OVERDUE");
    expect(result.daysRemaining).toBe(0);
    expect(result.milesRemaining).toBeGreaterThan(UPCOMING_MILES_BAND);
  });

  test("UPCOMING if either axis is within its band, even if the other is far off", () => {
    const result = computeDueStatus(base, 44_600, new Date(2026, 1, 1));
    expect(result.status).toBe("UPCOMING");
  });

  test("OK only when both axes are comfortably far off", () => {
    expect(computeDueStatus(base, 40_100, new Date(2026, 1, 1)).status).toBe("OK");
  });
});
