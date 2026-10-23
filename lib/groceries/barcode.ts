/**
 * Normalizes a scanned/typed barcode to Open Food Facts' own canonical form — verified live
 * against world.openfoodfacts.org (not guessed) by looking up the SAME product at 10, 11,
 * 12, 13, 14, and 15-digit lengths and reading back OFF's own `code` field each time:
 *
 *   9000006346      (10) -> 0009000006346
 *   49000006346      (11) -> 0049000006346
 *   049000006346      (12) -> 0049000006346
 *   0049000006346      (13) -> 0049000006346  (unchanged — the canonical form)
 *   00049000006346      (14) -> 0049000006346
 *   000049000006346      (15) -> 0049000006346
 *
 * The rule that reproduces this exactly: pad with leading zeros to 13, then keep the last
 * 13 digits. The one exception is a genuine 8-digit EAN-8 code, which OFF keeps AS-IS —
 * also verified live (a known EAN-8 product's `code` came back "40170725", not zero-padded
 * to 13) — so an 8-digit input is never touched. Without this, a product created from one
 * length (e.g. a 12-digit scan) and looked up later at another length (e.g. 11, a common
 * misread that drops the number-system digit) would miss on Product's
 * `@@unique([householdId, barcode])` and silently create a duplicate Product for the same
 * item.
 *
 * Strips everything but digits first — a manually-typed barcode routinely has spaces or
 * hyphens. Anything under 8 digits isn't a real barcode format at all and is rejected
 * rather than guessed at.
 *
 * Phase 10.5: an 8-digit code starting with 0 whose check digit is valid as UPC-E is a
 * compressed UPC-A (small cans and bottles), and is expanded. The camera scanner (zxing)
 * always reports UPC-E expanded to 13 digits, and Open Food Facts keeps the compressed and
 * expanded forms as two separate products (verified live: `04965802` and
 * `0049000006582` are both Diet Coke), so without this a typed or keyboard-wedge scan and
 * a camera scan of the same can would create two Products. The owner's call: expand. A genuine
 * EAN-8 starting with 0 is rare (GS1 reserves that range for restricted circulation), and
 * one whose check digit also happens to be valid as UPC-E rarer still.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  if (digits.length === 8) {
    const upcA = digits.startsWith("0") ? expandUpcE(digits) : null;
    return upcA ? upcA.padStart(13, "0") : digits;
  }
  return digits.padStart(13, "0").slice(-13);
}

/**
 * GS1 UPC-E -> UPC-A expansion (number system 0 only). Returns the 12-digit UPC-A, or null
 * when the code can't be a UPC-E: a wrong check digit, or a digit pattern GS1 forbids
 * (it would have been encoded with a shorter pattern). Both checks together keep a real
 * EAN-8 starting with 0 from being "expanded" into a code that doesn't exist.
 *
 * Number system 1 isn't expanded (a typed `1xxxxxxx` stays an EAN-8). zxing would expand
 * one from the camera, but GS1 never issued number-system-1 UPC-Es in practice.
 */
export function expandUpcE(code: string): string | null {
  if (!/^0\d{7}$/.test(code)) return null;
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7);
  const check = code[7];
  if (d6 === "3" && Number(d3) < 3) return null;
  if (d6 === "4" && d4 === "0") return null;
  if (Number(d6) >= 5 && d5 === "0") return null;
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const eleven = `0${body}`;
  return upcCheckDigit(eleven) === check ? `${eleven}${check}` : null;
}

/**
 * The inverse of expandUpcE: the 8-digit UPC-E for a 12- or 13-digit UPC-A (number system
 * 0), or null when it has no compressed form. Used to retry an Open Food Facts lookup
 * under the compressed code, which OFF sometimes files a product under instead.
 */
export function compressUpcA(code: string): string | null {
  const a = code.length === 13 && code.startsWith("0") ? code.slice(1) : code;
  if (!/^0\d{11}$/.test(a)) return null;
  const m = a.slice(1, 6);
  const p = a.slice(6, 11);
  let six: string | null = null;
  if (m.endsWith("00") && Number(m[2]) <= 2 && p.startsWith("00")) six = `${m[0]}${m[1]}${p.slice(2)}${m[2]}`;
  else if (m.endsWith("00") && p.startsWith("000")) six = `${m.slice(0, 3)}${p.slice(3)}3`;
  else if (m.endsWith("0") && p.startsWith("0000")) six = `${m.slice(0, 4)}${p[4]}4`;
  else if (p.startsWith("0000") && Number(p[4]) >= 5) six = `${m}${p[4]}`;
  if (!six) return null;
  const upcE = `0${six}${a[11]}`;
  // Round-trip through expandUpcE, so both directions share one definition of the rules.
  return expandUpcE(upcE) === a ? upcE : null;
}

/** The UPC-A/EAN check digit for the digits before it. */
function upcCheckDigit(digits: string): string {
  // Weights alternate 3,1 starting from the rightmost digit.
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const fromRight = digits.length - 1 - i;
    sum += Number(digits[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}
