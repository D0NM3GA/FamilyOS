import { compressUpcA } from "./barcode";
import type { OffProduct } from "./openfoodfacts";

/**
 * Open Food Facts lookup by the canonical (expanded, 13-digit) code, retried under the
 * compressed UPC-E form when there is one: OFF files some small cans and bottles only under
 * the 8-digit code (verified live: Diet Coke exists as both `04965802` and
 * `0049000006582`, as separate products). Typed and camera-scanned codes arrive here
 * identically expanded (Phase 10.5), so both get the same answer. A hit found under the
 * compressed code still reports the canonical code, so the Product is stored expanded and
 * a later scan finds it.
 */
export async function lookupWithUpcEFallback(
  canonical: string,
  lookup: (code: string) => Promise<OffProduct | null>,
): Promise<OffProduct | null> {
  const hit = await lookup(canonical);
  if (hit) return hit;
  const compressed = compressUpcA(canonical);
  if (!compressed) return null;
  const fallback = await lookup(compressed);
  return fallback ? { ...fallback, barcode: canonical } : null;
}
