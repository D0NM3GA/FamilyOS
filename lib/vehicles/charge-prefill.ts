/**
 * Phase 63b: a Money charge sent to Cars ("Log it in Cars": ?fuel=<cents>&on=<day> or
 * ?service=<cents>&on=<day>). Pure. Cents a whole number, up to $100,000; the day a real date, not
 * after today. Anything else: no prefill.
 */
export type ChargePrefill = { kind: "fuel" | "service"; cost: string; date: string };

const MAX_CENTS = 10_000_000;

export function parseChargePrefill(params: { fuel?: string | string[]; service?: string | string[]; on?: string | string[] }, today: string): ChargePrefill | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const fuel = one(params.fuel);
  const service = one(params.service);
  const on = one(params.on);
  const raw = fuel ?? service;
  if (!raw || !on || !/^\d{1,9}$/.test(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const cents = Number(raw);
  if (cents <= 0 || cents > MAX_CENTS) return null;
  const at = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== on || on > today) return null;
  return { kind: fuel ? "fuel" : "service", cost: (cents / 100).toFixed(2), date: on };
}
