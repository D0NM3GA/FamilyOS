import { describe, expect, it } from "vitest";
import { weatherFlagFor } from "./weather-flag";
import type { ForecastPeriod } from "@/lib/weather";

function period(overrides: Partial<ForecastPeriod>): ForecastPeriod {
  return {
    date: "2026-09-22",
    isDaytime: true,
    probabilityOfPrecipitation: 0,
    shortForecast: "Sunny",
    ...overrides,
  };
}

describe("weatherFlagFor", () => {
  it("returns null when there's no forecast data at all", () => {
    expect(weatherFlagFor(new Date(2026, 8, 22), null)).toBeNull();
  });

  it("flags at or above the 50% threshold", () => {
    const forecast = [period({ probabilityOfPrecipitation: 50, shortForecast: "Rain Likely" })];
    expect(weatherFlagFor(new Date(2026, 8, 22), forecast)).toBe("Rain Likely · 50%");
  });

  it("does not flag just below the threshold", () => {
    const forecast = [period({ probabilityOfPrecipitation: 49 })];
    expect(weatherFlagFor(new Date(2026, 8, 22), forecast)).toBeNull();
  });

  it("does not flag when probabilityOfPrecipitation is null", () => {
    const forecast = [period({ probabilityOfPrecipitation: null })];
    expect(weatherFlagFor(new Date(2026, 8, 22), forecast)).toBeNull();
  });

  it("does not flag a date beyond the forecast's own window", () => {
    const forecast = [period({ date: "2026-09-22", probabilityOfPrecipitation: 90 })];
    expect(weatherFlagFor(new Date(2026, 8, 29), forecast)).toBeNull(); // a week later
  });

  it("only matches the daytime period for a date, ignoring an evening-only entry", () => {
    const forecast = [
      period({ date: "2026-09-22", isDaytime: false, probabilityOfPrecipitation: 90 }),
    ];
    // Today's daytime period has already passed (only "Tonight" remains) — no flag, not a
    // false negative treated as "no rain."
    expect(weatherFlagFor(new Date(2026, 8, 22), forecast)).toBeNull();
  });

  it("matches by local calendar date regardless of the Date object's own time-of-day", () => {
    const forecast = [period({ date: "2026-09-22", probabilityOfPrecipitation: 75 })];
    const dueAtNoon = new Date(2026, 8, 22, 12, 0);
    expect(weatherFlagFor(dueAtNoon, forecast)).toBe("Sunny · 75%");
  });
});
