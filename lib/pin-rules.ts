/**
 * Profile-picker PIN rules (Settings → Household). Kids keep short PINs (4–6 digits); a
 * grown-up who uses a PIN instead of Microsoft needs 6 (owner's call, 2026-10-08), since their
 * profile opens adult pages. Anyone not marked a kid counts as a grown-up here.
 */
export function pinDigitsFor(role: string | null | undefined): { min: number; max: number } {
  return role === "KID" ? { min: 4, max: 6 } : { min: 6, max: 6 };
}

/** Why this PIN can't be used for this person, or null when it's fine. */
export function pinError(role: string | null | undefined, pin: string): string | null {
  const { min, max } = pinDigitsFor(role);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
    return min === max ? `A grown-up's PIN must be ${max} digits.` : `PIN must be ${min} to ${max} digits.`;
  }
  return null;
}
