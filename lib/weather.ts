/**
 * National Weather Service client — free, no key, US-only. Verified live during Phase 11's
 * scope AND implementation review (not assumed from docs), against real coordinates:
 * `https://api.weather.gov/points/{lat},{lon}` (200, `application/geo+json`) resolves to a
 * forecast grid; `properties.forecast` on that response is the actual forecast URL to fetch
 * next. Facts that shaped this client, all live-verified:
 * - More than 4 decimal places in the /points coordinates gets a 301 redirect to the
 *   4-decimal URL — round before building the URL, not after.
 * - A non-US/ocean coordinate 404s with a problem+json body, not a 5xx.
 * - The forecast has 14 periods (7 days, day/night split) — NOT 7, so a 14-day board
 *   horizon has no forecast for its last week; callers should know "no data" isn't "no
 *   flag needed."
 * - `probabilityOfPrecipitation.value` is nullable per NWS's own OpenAPI spec (confirmed in
 *   the spec even though no live sample happened to return one) — always guard it.
 * - Response carries `Cache-Control: public, max-age=3600` — matched below via Next's
 *   `fetch` cache-revalidate option instead of reinventing a TTL.
 */

import { outboundUserAgent } from "@/lib/user-agent";

// NWS's Terms of Service require a contact address in the User-Agent (lib/user-agent.ts).
const USER_AGENT = outboundUserAgent();
const TIMEOUT_MS = 4000;
const POINTS_REVALIDATE_S = 86400; // the lat/lon -> grid mapping never changes day to day
const FORECAST_REVALIDATE_S = 3600; // matches NWS's own Cache-Control max-age

export type ForecastPeriod = {
  /** Local calendar date this period falls on, "YYYY-MM-DD" — taken from `startTime`'s own
   * date portion, which is already in the forecast location's own UTC offset. */
  date: string;
  isDaytime: boolean;
  /** 0-100, or null if NWS didn't report one for this period (nullable per their spec). */
  probabilityOfPrecipitation: number | null;
  shortForecast: string;
};

/** Pure parsing, no fetch — testable against a fixture built from the live shape above. */
export function parseForecastPeriods(json: unknown): ForecastPeriod[] {
  const periods = (json as { properties?: { periods?: unknown } })?.properties?.periods;
  if (!Array.isArray(periods)) return [];

  const result: ForecastPeriod[] = [];
  for (const p of periods) {
    if (typeof p !== "object" || p === null) continue;
    const period = p as Record<string, unknown>;
    const startTime = period.startTime;
    if (typeof startTime !== "string" || startTime.length < 10) continue;

    const pop = period.probabilityOfPrecipitation;
    const value =
      typeof pop === "object" && pop !== null && typeof (pop as { value?: unknown }).value === "number"
        ? (pop as { value: number }).value
        : null;

    result.push({
      date: startTime.slice(0, 10),
      isDaytime: period.isDaytime === true,
      probabilityOfPrecipitation: value,
      shortForecast: typeof period.shortForecast === "string" ? period.shortForecast : "",
    });
  }
  return result;
}

// Skip retrying NWS for a while after a failure — Next's fetch cache only caches
// successful responses, so without this a live outage adds up to TIMEOUT_MS to every
// single board render for as long as it lasts.
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;
let lastFailureAt: number | null = null;

async function fetchJson(url: string, revalidateSeconds: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // network hiccup, timeout, whatever — never break a board render over it
  }
}

/**
 * The forecast for a location, or null if coordinates aren't set, NWS is unreachable, or the
 * point isn't covered (non-US). Never throws.
 */
export async function getDailyForecast(
  latitude: number | null,
  longitude: number | null,
): Promise<ForecastPeriod[] | null> {
  if (latitude == null || longitude == null) return null;

  if (lastFailureAt != null && Date.now() - lastFailureAt < NEGATIVE_CACHE_MS) return null;

  const lat = latitude.toFixed(4);
  const lon = longitude.toFixed(4);

  const points = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`, POINTS_REVALIDATE_S);
  const forecastUrl = (points as { properties?: { forecast?: unknown } })?.properties?.forecast;
  if (typeof forecastUrl !== "string") {
    lastFailureAt = Date.now();
    return null;
  }

  const forecast = await fetchJson(forecastUrl, FORECAST_REVALIDATE_S);
  if (forecast == null) {
    lastFailureAt = Date.now();
    return null;
  }

  lastFailureAt = null;
  return parseForecastPeriods(forecast);
}
