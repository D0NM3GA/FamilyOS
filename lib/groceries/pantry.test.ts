import { describe, expect, it } from "vitest";
import { computePantrySuggestions, type PurchaseHistoryRow } from "./pantry";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function row(key: string, daysAgoBought: number, label = key): PurchaseHistoryRow {
  return { key, label, productId: null, purchasedAt: daysAgo(daysAgoBought) };
}

describe("computePantrySuggestions", () => {
  it("suggests nothing with fewer than 3 distinct purchase days", () => {
    const rows = [row("milk", 14), row("milk", 7)]; // 2 days = 1 interval, not enough
    expect(computePantrySuggestions(rows, NOW)).toEqual([]);
  });

  it("flags a regular weekly item once daysSinceLast reaches the median interval", () => {
    // Bought on days 21, 14, 7 ago -> two 7-day intervals, median 7. Last bought 7 days
    // ago, so it's due today.
    const rows = [row("milk", 21), row("milk", 14), row("milk", 7)];
    const result = computePantrySuggestions(rows, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("milk");
    expect(result[0].medianIntervalDays).toBe(7);
    expect(result[0].daysSinceLast).toBe(7);
  });

  it("does not flag an item still within its usual cadence", () => {
    const rows = [row("milk", 21), row("milk", 14), row("milk", 2)]; // last bought 2 days ago, cadence ~7-9
    expect(computePantrySuggestions(rows, NOW)).toEqual([]);
  });

  it("collapses same-day duplicates (two trips, or the same item twice in one trip) to one data point", () => {
    const rows = [
      row("eggs", 21),
      row("eggs", 21), // same day as above — must not count as its own interval
      row("eggs", 14),
      row("eggs", 7),
    ];
    const result = computePantrySuggestions(rows, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].medianIntervalDays).toBe(7);
  });

  it("uses the median, not the mean, so one long gap (vacation) doesn't skew a regular cadence", () => {
    // Chronological (oldest to newest) days-ago: 51, 44, 37, then a 28-day vacation gap, 9.
    // Intervals: 7, 7, 28 -> median 7 (mean would be 14, overstating the cadence and
    // pushing the "due" point weeks later than it should be). Last bought 9 days ago, which
    // is >= the true 7-day median (due) and well inside the 3x21-day staleness ceiling.
    const rows = [row("coffee", 51), row("coffee", 44), row("coffee", 37), row("coffee", 9)];
    const result = computePantrySuggestions(rows, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].medianIntervalDays).toBe(7);
    expect(result[0].daysSinceLast).toBe(9);
  });

  it("stops suggesting once daysSinceLast exceeds the staleness ceiling (3x median)", () => {
    // Chronological days-ago: 120, 113, 106 (weekly, median 7), then nothing for 76 days.
    // Last bought 30 days ago; ceiling is 3*7=21, so 30 is past it — treat as
    // abandoned/seasonal, not "overdue forever".
    const rows = [row("sunscreen", 120), row("sunscreen", 113), row("sunscreen", 106), row("sunscreen", 30)];
    expect(computePantrySuggestions(rows, NOW)).toEqual([]);
  });

  it("excludes a key already on the current list", () => {
    const rows = [row("milk", 21), row("milk", 14), row("milk", 7)];
    expect(computePantrySuggestions(rows, NOW, { excludeKeys: new Set(["milk"]) })).toEqual([]);
  });

  it("ranks most-overdue-relative-to-cadence first", () => {
    // "milk": weekly, 7 days overdue relative to its own cadence (daysSinceLast == median).
    // "coffee": every ~14 days, but 42 days since last (3x median, right at the ceiling) —
    // more overdue relative to its own cadence.
    const milk = [row("milk", 21), row("milk", 14), row("milk", 7)];
    const coffee = [row("coffee", 70), row("coffee", 56), row("coffee", 42)];
    const result = computePantrySuggestions([...milk, ...coffee], NOW);
    expect(result.map((r) => r.key)).toEqual(["coffee", "milk"]);
  });

  it("caps at the given limit", () => {
    const rows: PurchaseHistoryRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row(`item${i}`, 21), row(`item${i}`, 14), row(`item${i}`, 7));
    }
    expect(computePantrySuggestions(rows, NOW, { limit: 3 })).toHaveLength(3);
  });
});
