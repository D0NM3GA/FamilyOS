import { checkVin } from "./vin";

/**
 * Phase 53: a VIN decoded by NHTSA's vPIC (free, no key):
 * `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json` → one row of
 * named values. `ErrorCode` is a comma list: "0" is a clean decode; other codes alongside a
 * Make mean a partial decode (some parts of the VIN didn't read); no Make means it couldn't be
 * read. Never throws. The VIN is in the address, so the answer isn't cached on disk, and the
 * address is private to Sentry (lib/observability/options.ts).
 */

const TIMEOUT_MS = 4000;
const BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
// After a failure, skip vPIC for a while, as the recall check does with NHTSA.
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;
let lastFailureAt: number | null = null;

export type VinDecode =
  | { status: "ok"; partial: boolean; make: string; model: string | null; year: number | null; trim: string | null; engine: string | null }
  | { status: "unreadable" }
  | { status: "invalid"; error: string }
  | { status: "unavailable" };

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** vPIC's row, read into the form's fields. Exported for tests. */
export function readDecode(body: unknown): VinDecode {
  const row = (body as { Results?: Record<string, unknown>[] } | null)?.Results?.[0];
  if (!row) return { status: "unavailable" };
  const make = text(row.Make);
  if (!make) return { status: "unreadable" };
  const codes = new Set((text(row.ErrorCode) ?? "").split(",").map((c) => c.trim()).filter(Boolean));
  const year = Number(text(row.ModelYear));
  const litres = Number(text(row.DisplacementL));
  const cylinders = text(row.EngineCylinders);
  const engine = [Number.isFinite(litres) && litres > 0 ? `${litres.toFixed(1)} L` : null, cylinders ? `${cylinders} cylinders` : null, text(row.FuelTypePrimary)]
    .filter(Boolean)
    .join(", ");
  // Title case: vPIC says "HONDA".
  const title = (s: string) => (s === s.toUpperCase() && s.length > 3 ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);
  return {
    status: "ok",
    partial: !(codes.size === 1 && codes.has("0")),
    make: title(make),
    model: text(row.Model),
    year: Number.isInteger(year) && year > 1900 ? year : null,
    trim: text(row.Trim),
    engine: engine || null,
  };
}

export async function decodeVin(raw: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<VinDecode> {
  const checked = checkVin(raw);
  if (!checked.ok) return { status: "invalid", error: checked.error };
  if (lastFailureAt != null && now - lastFailureAt < NEGATIVE_CACHE_MS) return { status: "unavailable" };
  try {
    const res = await fetchFn(`${BASE}/${encodeURIComponent(checked.vin)}?format=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`vPIC ${res.status}`);
    const decoded = readDecode(await res.json());
    if (decoded.status === "unavailable") throw new Error("vPIC answered nothing");
    lastFailureAt = null;
    return decoded;
  } catch {
    lastFailureAt = now;
    return { status: "unavailable" };
  }
}

/** Tests only. */
export function resetVpic() {
  lastFailureAt = null;
}
