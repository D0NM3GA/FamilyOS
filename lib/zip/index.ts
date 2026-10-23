import "server-only";
import table from "./zcta.json";

/**
 * Phase 45.1: where home is, without typing coordinates. Every US ZIP code's center (the
 * Census Bureau's ZCTAs, lib/zip/zcta.json, built by scripts/build-zip-table.mjs) answers a typed
 * ZIP code, names the ZIP nearest a phone's location ("near ZIP 12345"), and tells a home outside
 * the Weather Service's area apart, all on the server, with no geocoding service. Server-only:
 * the table is close to a megabyte and no browser needs it.
 */

export type HomePoint = { latitude: number; longitude: number };
export type HomeCheck =
  | ({ ok: true; nearZip: string } & HomePoint)
  | { ok: false; reason: "invalid" | "outside" | "unknownZip" };

/**
 * How far the nearest ZIP center can be before a point counts as outside the US (the Weather
 * Service covers the 50 states, DC and Puerto Rico, as the table does). Generous, since a ZIP
 * in rural Alaska spans hundreds of square miles.
 */
export const OUTSIDE_KM = 100;

type Row = [string, number, number];
const rows = table.rows as Row[];
let byZip: Map<string, Row> | null = null;

/** Two decimal places, about a kilometre: what the app keeps of a home, never a house's own point. */
export function roundToKilometre(n: number): number {
  return Math.round(n * 100) / 100;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** A typed ZIP code's center, or null when it has none (PO boxes and unused codes). */
export function lookupZip(zip: string): ({ zip: string } & HomePoint) | null {
  const clean = zip.trim();
  if (!/^\d{5}$/.test(clean)) return null;
  byZip ??= new Map(rows.map((r) => [r[0], r]));
  const row = byZip.get(clean);
  return row ? { zip: row[0], latitude: row[1], longitude: row[2] } : null;
}

/** The ZIP code whose center is nearest a point, and how far it is. */
export function nearestZip(latitude: number, longitude: number): { zip: string; km: number } {
  let best = rows[0];
  let bestKm = Infinity;
  for (const row of rows) {
    // A cheap box test first: most rows are thousands of kilometres away.
    if (Math.abs(row[1] - latitude) > 3 && bestKm < 300) continue;
    const km = distanceKm(latitude, longitude, row[1], row[2]);
    if (km < bestKm) {
      best = row;
      bestKm = km;
    }
  }
  return { zip: best[0], km: bestKm };
}

/** A point from a phone (or anywhere): rounded to a kilometre, and refused outside the US. */
export function checkHomePoint(latitude: unknown, longitude: unknown): HomeCheck {
  if (typeof latitude !== "number" || typeof longitude !== "number") return { ok: false, reason: "invalid" };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, reason: "invalid" };
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { ok: false, reason: "invalid" };
  const point = { latitude: roundToKilometre(latitude), longitude: roundToKilometre(longitude) };
  const near = nearestZip(point.latitude, point.longitude);
  if (near.km > OUTSIDE_KM) return { ok: false, reason: "outside" };
  return { ok: true, nearZip: near.zip, ...point };
}

/** A typed ZIP code, as a home point. */
export function checkHomeZip(zip: unknown): HomeCheck {
  if (typeof zip !== "string") return { ok: false, reason: "invalid" };
  const found = lookupZip(zip);
  if (!found) return { ok: false, reason: /^\s*\d{5}\s*$/.test(zip) ? "unknownZip" : "invalid" };
  return { ok: true, nearZip: found.zip, latitude: found.latitude, longitude: found.longitude };
}
