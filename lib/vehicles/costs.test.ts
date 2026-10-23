import { describe, expect, test } from "vitest";
import { summarizeCosts } from "./costs";

const today = new Date(2026, 8, 22);

describe("summarizeCosts", () => {
  const service = [
    { date: new Date(2024, 0, 10), mileage: 40_000, costCents: 50_000 }, // outside 12 months
    { date: new Date(2026, 2, 1), mileage: 52_000, costCents: 8_000 },
    { date: new Date(2026, 5, 1), mileage: 54_000, costCents: null }, // cost not recorded
  ];
  const fuel = [
    { date: new Date(2026, 0, 5), mileage: 50_000, costCents: 4_000 },
    { date: new Date(2026, 7, 5), mileage: 55_000, costCents: 4_500 },
  ];

  const result = summarizeCosts({ service, fuel, currentMileage: 56_000, today });

  test("lifetime totals, miles from the lowest reading up to the current odometer", () => {
    expect(result.lifetime).toMatchObject({ serviceCents: 58_000, fuelCents: 8_500, totalCents: 66_500 });
    expect(result.lifetime.miles).toBe(16_000);
    expect(result.lifetime.centsPerMile).toBeCloseTo(66_500 / 16_000);
  });

  test("last 12 months buckets by the event date and ignores older entries", () => {
    expect(result.last12Months).toMatchObject({ serviceCents: 8_000, fuelCents: 8_500, totalCents: 16_500 });
    expect(result.last12Months.miles).toBe(6_000); // 56,000 - 50,000
  });

  test("an entry dated exactly 12 months ago counts, even when `today` carries a time of day", () => {
    const boundary = summarizeCosts({
      service: [{ date: new Date(2025, 8, 22), mileage: 45_000, costCents: 1_000 }],
      fuel: [],
      currentMileage: 50_000,
      today: new Date(2026, 8, 22, 15, 30),
    });
    expect(boundary.last12Months.serviceCents).toBe(1_000);
  });

  test("no entries -> no miles and no per-mile cost", () => {
    const empty = summarizeCosts({ service: [], fuel: [], currentMileage: 10_000, today });
    expect(empty.lifetime).toEqual({ serviceCents: 0, fuelCents: 0, totalCents: 0, miles: null, centsPerMile: null });
  });
});
