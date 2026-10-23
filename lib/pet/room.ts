import type { Weather } from "./behavior";
import type { RoomSlot } from "./items";

/**
 * Phase 47: the room's window shows the real day: the sky from the household's clock, the
 * weather from today's forecast (lib/weather.ts, which Chores already uses), and a touch of
 * the season. Display only. Pure and client-safe.
 */

export type Sky = "dawn" | "day" | "dusk" | "night";
export type Season = "spring" | "summer" | "autumn" | "winter";

export function skyAt(hour: number): Sky {
  if (hour >= 6 && hour < 9) return "dawn";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** Northern-hemisphere seasons: the forecast (and so the window's weather) is US-only anyway. */
export function seasonOf(month: number): Season {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

/** The weather in a forecast's short words ("Chance Rain Showers", "Mostly Cloudy"). */
export function weatherFrom(shortForecast: string | null | undefined): Weather {
  const words = (shortForecast ?? "").toLowerCase();
  if (/snow|flurr|sleet|blizzard/.test(words)) return "snow";
  if (/rain|shower|storm|drizzle/.test(words)) return "rain";
  if (/cloud|overcast|fog|haze/.test(words)) return "cloudy";
  return "clear";
}

/** The room is drawn in a 400-wide frame; things on top are placed as percentages of it. */
export const ROOM_W = 400;

/** Where each slot's item stands (its bottom center), in room units. */
export const SLOT_ANCHORS: Record<RoomSlot, { x: number; y: number }> = {
  wall: { x: 72, y: 100 },
  shelf: { x: 335, y: 93 },
  sill: { x: 200, y: 104 },
  "floor-left": { x: 62, y: 228 },
  "floor-right": { x: 258, y: 205 },
};
