/**
 * Phase 53: a Vehicle Identification Number. 17 characters, letters and digits without I, O or Q
 * (they look like 1 and 0). Position 9 is a check digit only for cars sold in North America (a
 * first character of 1 to 5); any other VIN is taken as it is (docs/PLAN.md, Phase 53). Pure.
 */

const VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export type VinCheck = { ok: true; vin: string } | { ok: false; error: string };

/** What someone typed or a scanner read, tidied: upper case, no spaces or dashes, no import marker. */
export function tidyVin(raw: string): string {
  let vin = raw.toUpperCase().replace(/[\s-]/g, "");
  // Some door-jamb barcodes add a leading "I" (an import marker) to the 17 characters.
  if (vin.length === 18 && vin.startsWith("I")) vin = vin.slice(1);
  return vin;
}

function checkDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const value = /\d/.test(c) ? Number(c) : VALUES[c];
    sum += value * WEIGHTS[i];
  }
  const rest = sum % 11;
  return rest === 10 ? "X" : String(rest);
}

export function checkVin(raw: string): VinCheck {
  const vin = tidyVin(raw);
  if (vin.length !== 17) return { ok: false, error: "A VIN is 17 characters." };
  if (/[IOQ]/.test(vin)) return { ok: false, error: "A VIN never has the letters I, O or Q (they'd look like 1 and 0)." };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, error: "A VIN is only letters and digits." };
  if (/^[1-5]/.test(vin) && vin[8] !== checkDigit(vin)) {
    return { ok: false, error: "That VIN doesn't add up (its check digit is off). Look again at each character." };
  }
  return { ok: true, vin };
}

/** A VIN from a backup or an older row: kept only if it's still a VIN. */
export function cleanVin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = checkVin(raw);
  return v.ok ? v.vin : null;
}
