import type { Weather } from "./behavior";
import { fitsPlace, SURFACES, type Surface } from "./items";

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

/**
 * Phase 56: where each surface is, in room units. A decoration stands (or hangs) with its
 * bottom center on the surface's line `y`, anywhere from `from` to `to` that keeps all of it
 * on there; on the floor it can also sit nearer or further, between `y` and `front`. `drop` is
 * the patch of room where letting go lands on this surface; `home` is where a decoration put
 * there with no spot of its own stands.
 */
type SurfaceSpan = { y: number; front?: number; from: number; to: number; home: number; drop: { x0: number; y0: number; x1: number; y1: number } };

export const SURFACE_SPANS: Record<Surface, SurfaceSpan> = {
  wall: { y: 100, from: 6, to: 138, home: 72, drop: { x0: 0, y0: 0, x1: 140, y1: 130 } },
  sill: { y: 104, from: 144, to: 256, home: 200, drop: { x0: 142, y0: 40, x1: 258, y1: 130 } },
  shelf: { y: 93, from: 292, to: 378, home: 335, drop: { x0: 270, y0: 20, x1: ROOM_W, y1: 130 } },
  // Not over the bed, which every room has on the right.
  floor: { y: 205, front: 236, from: 8, to: 296, home: 62, drop: { x0: 0, y0: 130, x1: ROOM_W, y1: 260 } },
};

/**
 * Each decoration's outline around its bottom center: half its width, how far it reaches up,
 * and how far up it starts (fairy lights hang high), so the whole of it stays on its surface
 * and a drag can pick it up anywhere on it.
 */
export const DECOR_BOX: Record<string, readonly [half: number, top: number, bottom?: number]> = {
  plant: [18, 44],
  cushion: [24, 17],
  beanbag: [28, 34],
  poster: [24, 56],
  clock: [18, 50],
  lamp: [14, 40],
  fishbowl: [14, 28],
  flowers: [26, 26],
  "fairy-lights": [40, 64, 44],
  rocket: [14, 48],
  rainbow: [26, 50],
};

/** A decoration in the room: what it is, which surface, and where its bottom center stands. */
export type RoomDecor = { itemId: string; surface: Surface; x: number; y: number };

const clamp = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(high, value)));

/** Where a decoration stands on a surface, near `x` (and, on the floor, `y`), kept on it. */
export function standOn(itemId: string, surface: Surface, x: number | null, y: number | null): RoomDecor {
  const span = SURFACE_SPANS[surface];
  const half = Math.min(DECOR_BOX[itemId]?.[0] ?? 20, (span.to - span.from) / 2);
  return {
    itemId,
    surface,
    x: clamp(x ?? span.home, span.from + half, span.to - half),
    y: span.front === undefined ? span.y : clamp(y ?? span.y, span.y, span.front),
  };
}

/**
 * Where a decoration let go of at `point` (room units) lands: on whichever surface it fits
 * that's nearest the point, as close to the point as that surface allows. Null if it fits
 * nowhere in the room.
 */
export function dropAt(itemId: string, point: { x: number; y: number }): RoomDecor | null {
  let best: { surface: Surface; distance: number } | null = null;
  for (const surface of SURFACES) {
    if (!fitsPlace(itemId, surface)) continue;
    const { x0, y0, x1, y1 } = SURFACE_SPANS[surface].drop;
    const distance = Math.hypot(Math.max(x0 - point.x, 0, point.x - x1), Math.max(y0 - point.y, 0, point.y - y1));
    if (!best || distance < best.distance) best = { surface, distance };
  }
  return best && standOn(itemId, best.surface, point.x, point.y);
}

/** Back of the room first, so nearer things are drawn over further ones. */
export function inDrawingOrder(decor: readonly RoomDecor[]): RoomDecor[] {
  return [...decor].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Where poop lands, first to last, in room units (the cleaning puff goes here too). */
export const POOP_SPOTS = [
  { x: 150, y: 238 },
  { x: 182, y: 250 },
  { x: 228, y: 244 },
  { x: 120, y: 252 },
];

/** The food bowl, where a meal flies from. */
export const BOWL = { x: 26, y: 232 };

export const ROOM_H = 260;
