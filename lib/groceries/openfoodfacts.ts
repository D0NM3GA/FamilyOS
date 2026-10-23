/**
 * Open Food Facts client — no API key needed, but they ask every caller to identify
 * itself with a custom User-Agent. Read-only, so no auth beyond that.
 * https://openfoodfacts.github.io/openfoodfacts-server/api/
 *
 * The v3 product endpoint with `product_type=all` searches the sister databases too (Open
 * Pet Food Facts, Open Products Facts), so dog food and paper towels can match, not just
 * food. Data is ODbL; the item sheet credits it.
 */

import { outboundUserAgent } from "@/lib/user-agent";
import { OPEN_FOOD_FACTS_IMAGES } from "@/lib/security/csp";

const BASE = "https://world.openfoodfacts.org";
const USER_AGENT = outboundUserAgent();
// fetch() has no default overall timeout (Node's undici headers timeout is 300s) — without
// this, a stalled request (a phone with one bar of signal, standing in a store) hangs the
// caller for minutes instead of degrading to the "couldn't find it, add by hand" path
// within a few seconds.
const TIMEOUT_MS = 5000;

export type OffProduct = {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  /** The package size as printed, e.g. "31.1 lb" or "400 g ℮". Parse with lib/groceries/size.ts. */
  quantity: string | null;
};

const FOUND = new Set(["success", "success_with_warnings"]);

export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  const code = barcode.trim();
  if (!code) return null;

  try {
    const res = await fetch(
      `${BASE}/api/v3/product/${encodeURIComponent(code)}?product_type=all&fields=code,product_name,brands,image_url,quantity`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (!FOUND.has(data.status) || typeof data.product?.product_name !== "string" || !data.product.product_name.trim()) {
      return null;
    }

    return {
      // OFF's own canonical code, not the caller's input — a 12-digit UPC-A lookup and a
      // 13-digit EAN-13 lookup for the same product both return the same 13-digit `code`
      // here, which is what keeps Product.barcode's uniqueness meaningful (see
      // lib/groceries/barcode.ts's normalizeBarcode, which callers should also run on
      // manual input before it ever reaches this function or the database).
      barcode: data.product.code ?? data.code ?? code,
      name: data.product.product_name.trim(),
      brand: data.product.brands ?? null,
      // Rendered as <img src>: only Open Food Facts' own image host, never javascript: or data:
      // from the API, and the one host the script policy allows (Phase 42, lib/security/csp.ts).
      imageUrl: typeof data.product.image_url === "string" && data.product.image_url.startsWith(`${OPEN_FOOD_FACTS_IMAGES}/`) ? data.product.image_url : null,
      quantity: typeof data.product.quantity === "string" ? data.product.quantity : null,
    };
  } catch {
    return null; // network hiccup, rate limit, whatever — never break the add box over it
  }
}
