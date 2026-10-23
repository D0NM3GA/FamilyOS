import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseForecastPeriods } from "./weather";

// Trimmed from a real, live api.weather.gov response captured during Phase 11's scope and
// implementation review — 14 periods (7 days, day/night split), a startTime carrying the
// location's own UTC offset, and (added deliberately, since no live sample happened to
// return one) a null probabilityOfPrecipitation.value to exercise NWS's own documented
// nullable field.
const LIVE_FIXTURE = {
  properties: {
    periods: [
      {
        number: 1,
        name: "Tonight",
        startTime: "2026-09-21T22:00:00-05:00",
        isDaytime: false,
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 13 },
        shortForecast: "Cloudy",
      },
      {
        number: 2,
        name: "Tuesday",
        startTime: "2026-09-22T06:00:00-05:00",
        isDaytime: true,
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 80 },
        shortForecast: "Rain Likely",
      },
      {
        number: 3,
        name: "Tuesday Night",
        startTime: "2026-09-22T18:00:00-05:00",
        isDaytime: false,
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: null },
        shortForecast: "Mostly Cloudy",
      },
    ],
  },
};

describe("parseForecastPeriods", () => {
  it("extracts date (from startTime), isDaytime, PoP, and shortForecast", () => {
    const result = parseForecastPeriods(LIVE_FIXTURE);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({
      date: "2026-09-22",
      isDaytime: true,
      probabilityOfPrecipitation: 80,
      shortForecast: "Rain Likely",
    });
  });

  it("returns null (not NaN or a crash) for a period with no PoP value", () => {
    const result = parseForecastPeriods(LIVE_FIXTURE);
    expect(result[2].probabilityOfPrecipitation).toBeNull();
  });

  it("returns an empty array for anything malformed rather than throwing", () => {
    expect(parseForecastPeriods(null)).toEqual([]);
    expect(parseForecastPeriods(undefined)).toEqual([]);
    expect(parseForecastPeriods({})).toEqual([]);
    expect(parseForecastPeriods({ properties: {} })).toEqual([]);
    expect(parseForecastPeriods({ properties: { periods: "not an array" } })).toEqual([]);
  });

  it("skips individual malformed periods without dropping the rest", () => {
    const result = parseForecastPeriods({
      properties: { periods: [null, { startTime: "bad" }, LIVE_FIXTURE.properties.periods[0]] },
    });
    expect(result).toHaveLength(1);
  });
});

describe("getDailyForecast", () => {
  // getDailyForecast keeps a module-level negative cache (see its own comment) — a fresh
  // module instance per test via resetModules + a dynamic re-import is what keeps one
  // test's simulated failure from silently short-circuiting the next test's fetch mock
  // for the following 10 minutes (longer than any test run) and making it pass for the
  // wrong reason.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null without calling fetch when coordinates are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getDailyForecast } = await import("./weather");
    expect(await getDailyForecast(null, -87.6298)).toBeNull();
    expect(await getDailyForecast(41.8781, null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rounds coordinates to 4 decimal places in the request URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ properties: { forecast: "https://api.weather.gov/gridpoints/LOT/76,73/forecast" } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => LIVE_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);
    const { getDailyForecast } = await import("./weather");

    await getDailyForecast(41.87812345, -87.62981234);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.weather.gov/points/41.8781,-87.6298");
  });

  it("returns null when the points lookup has no forecast URL (e.g. a 404 for a non-US point)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const { getDailyForecast } = await import("./weather");
    expect(await getDailyForecast(0, 0)).toBeNull();
  });

  it("returns null rather than throwing on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const { getDailyForecast } = await import("./weather");
    expect(await getDailyForecast(41.8781, -87.6298)).toBeNull();
  });

  it("skips a second live fetch for a short window after a failure (negative cache)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { getDailyForecast } = await import("./weather");

    await getDailyForecast(41.8781, -87.6298); // fails, arms the negative cache
    await getDailyForecast(41.8781, -87.6298); // should short-circuit, not call fetch again

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
