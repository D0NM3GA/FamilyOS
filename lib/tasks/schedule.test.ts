import { describe, expect, test } from "vitest";
import {
  addDays,
  addMonths,
  atMidnight,
  expandTimesOfDay,
  firstOccurrenceOnOrAfter,
  generateOccurrences,
  type RecurrenceRule,
} from "./schedule";

function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    frequencyType: "DAILY",
    startDate: new Date(2026, 0, 1),
    interval: null,
    daysOfWeek: [],
    ...overrides,
  };
}

describe("addMonths", () => {
  test("clamps to the last day of a shorter target month", () => {
    // Jan 31, 2026 -> Feb has 28 days (2026 is not a leap year)
    expect(addMonths(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
  });

  test("always references the original anchor day, not a previously clamped one", () => {
    const start = new Date(2026, 0, 31);
    // Two months out lands in March, which has 31 days again — should NOT stay stuck at 28/30.
    expect(addMonths(start, 2)).toEqual(new Date(2026, 2, 31));
  });
});

describe("firstOccurrenceOnOrAfter — ONCE", () => {
  test("returns the start date if queried before or on it", () => {
    const r = rule({ frequencyType: "ONCE", startDate: new Date(2026, 2, 10) });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 1))).toEqual(new Date(2026, 2, 10));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 10))).toEqual(new Date(2026, 2, 10));
  });

  test("returns null once the single occurrence has passed", () => {
    const r = rule({ frequencyType: "ONCE", startDate: new Date(2026, 2, 10) });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 11))).toBeNull();
  });
});

describe("firstOccurrenceOnOrAfter — DAILY", () => {
  test("every day is an occurrence", () => {
    const r = rule({ frequencyType: "DAILY", startDate: new Date(2026, 2, 10) });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 15))).toEqual(new Date(2026, 2, 15));
  });

  test("never returns a date before startDate", () => {
    const r = rule({ frequencyType: "DAILY", startDate: new Date(2026, 2, 10) });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 1))).toEqual(new Date(2026, 2, 10));
  });
});

describe("firstOccurrenceOnOrAfter — INTERVAL_DAYS", () => {
  test("steps by the configured interval from startDate", () => {
    const r = rule({
      frequencyType: "INTERVAL_DAYS",
      startDate: new Date(2026, 2, 10),
      interval: 3,
    });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 10))).toEqual(new Date(2026, 2, 10));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 11))).toEqual(new Date(2026, 2, 13));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 13))).toEqual(new Date(2026, 2, 13));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 14))).toEqual(new Date(2026, 2, 16));
  });

  test("defaults to every 1 day when interval is null", () => {
    const r = rule({ frequencyType: "INTERVAL_DAYS", startDate: new Date(2026, 2, 10), interval: null });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 11))).toEqual(new Date(2026, 2, 11));
  });
});

describe("firstOccurrenceOnOrAfter — WEEKLY", () => {
  test("steps by N weeks from startDate", () => {
    const r = rule({ frequencyType: "WEEKLY", startDate: new Date(2026, 2, 10), interval: 2 });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 11))).toEqual(new Date(2026, 2, 24));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 24))).toEqual(new Date(2026, 2, 24));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 25))).toEqual(new Date(2026, 3, 7));
  });
});

describe("firstOccurrenceOnOrAfter — MONTHLY", () => {
  test("steps by N months, clamping day-of-month as needed", () => {
    const r = rule({ frequencyType: "MONTHLY", startDate: new Date(2026, 0, 31), interval: 1 });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 1, 1))).toEqual(new Date(2026, 1, 28));
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 2, 1))).toEqual(new Date(2026, 2, 31));
  });
});

describe("firstOccurrenceOnOrAfter — DAYS_OF_WEEK", () => {
  test("only lands on the configured weekdays, self-verified against a brute-force scan", () => {
    const start = new Date(2026, 0, 1);
    const startDow = start.getDay();
    const otherDow = (startDow + 2) % 7;
    const r = rule({
      frequencyType: "DAYS_OF_WEEK",
      startDate: start,
      daysOfWeek: [startDow, otherDow],
    });

    expect(firstOccurrenceOnOrAfter(r, start)).toEqual(start);

    let expected = addDays(start, 1);
    while (!r.daysOfWeek.includes(expected.getDay())) {
      expected = addDays(expected, 1);
    }
    expect(firstOccurrenceOnOrAfter(r, addDays(start, 1))).toEqual(expected);
  });

  test("returns null when no weekdays are configured", () => {
    const r = rule({ frequencyType: "DAYS_OF_WEEK", daysOfWeek: [] });
    expect(firstOccurrenceOnOrAfter(r, new Date(2026, 0, 1))).toBeNull();
  });
});

describe("generateOccurrences", () => {
  test("collects every occurrence within [from, to]", () => {
    const r = rule({ frequencyType: "DAILY", startDate: new Date(2026, 2, 10) });
    const dates = generateOccurrences(r, {
      from: new Date(2026, 2, 10),
      to: new Date(2026, 2, 14),
    });
    expect(dates).toEqual([
      new Date(2026, 2, 10),
      new Date(2026, 2, 11),
      new Date(2026, 2, 12),
      new Date(2026, 2, 13),
      new Date(2026, 2, 14),
    ]);
  });

  test("returns an empty array once a ONCE series is exhausted", () => {
    const r = rule({ frequencyType: "ONCE", startDate: new Date(2026, 2, 10) });
    const dates = generateOccurrences(r, {
      from: new Date(2026, 2, 11),
      to: new Date(2026, 2, 20),
    });
    expect(dates).toEqual([]);
  });
});

describe("atMidnight", () => {
  test("strips the time-of-day component", () => {
    const d = new Date(2026, 5, 15, 13, 45, 30);
    expect(atMidnight(d)).toEqual(new Date(2026, 5, 15));
  });
});

describe("expandTimesOfDay", () => {
  test("returns the input unchanged when timesOfDay is empty (chores' behavior)", () => {
    const days = [new Date(2026, 2, 10), new Date(2026, 2, 11)];
    expect(expandTimesOfDay(days, [])).toBe(days);
  });

  test("produces one Date per (day x time) pair, same calendar day, given hours/minutes", () => {
    const days = [new Date(2026, 2, 10), new Date(2026, 2, 11)];
    const result = expandTimesOfDay(days, ["08:00", "20:30"]);
    expect(result).toEqual([
      new Date(2026, 2, 10, 8, 0),
      new Date(2026, 2, 10, 20, 30),
      new Date(2026, 2, 11, 8, 0),
      new Date(2026, 2, 11, 20, 30),
    ]);
  });

  test("a single time of day still expands (not treated as empty)", () => {
    const days = [new Date(2026, 2, 10)];
    expect(expandTimesOfDay(days, ["09:15"])).toEqual([new Date(2026, 2, 10, 9, 15)]);
  });
});
