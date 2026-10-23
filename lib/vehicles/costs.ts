import { addMonths, atMidnight } from "@/lib/tasks/schedule";

type CostEntry = { date: Date; mileage: number; costCents: number | null };

export type CostWindow = {
  serviceCents: number;
  fuelCents: number;
  totalCents: number;
  /** Miles driven over the window, or null if there's no usable odometer baseline. */
  miles: number | null;
  /** Total cost per mile, in cents (fractional); null when miles is null. */
  centsPerMile: number | null;
};

export type CostSummary = { lifetime: CostWindow; last12Months: CostWindow };

/**
 * Cost of ownership over two windows, bucketed by when the service/fill-up happened
 * (doneAt/filledAt), not when it was logged. Miles for a window run from the lowest
 * odometer reading logged inside it up to the vehicle's *current* odometer — using the
 * highest logged reading instead would undercount every mile driven since the last log.
 * Entries with no recorded cost count toward miles but add nothing to the totals.
 */
export function summarizeCosts(input: {
  service: readonly CostEntry[];
  fuel: readonly CostEntry[];
  currentMileage: number;
  today: Date;
}): CostSummary {
  // Midnight-normalized: entry dates are local midnight, and a time-of-day `today` would
  // otherwise drop an entry dated exactly 12 months ago.
  const windowStart = atMidnight(addMonths(input.today, -12));
  return {
    lifetime: summarizeWindow(input.service, input.fuel, input.currentMileage, null),
    last12Months: summarizeWindow(input.service, input.fuel, input.currentMileage, windowStart),
  };
}

function summarizeWindow(
  service: readonly CostEntry[],
  fuel: readonly CostEntry[],
  currentMileage: number,
  since: Date | null,
): CostWindow {
  const inWindow = (e: CostEntry) => since == null || e.date >= since;
  const s = service.filter(inWindow);
  const f = fuel.filter(inWindow);

  const serviceCents = s.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const fuelCents = f.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
  const totalCents = serviceCents + fuelCents;

  const readings = [...s, ...f].map((e) => e.mileage);
  const miles = readings.length > 0 ? currentMileage - Math.min(...readings) : null;
  const usableMiles = miles != null && miles > 0 ? miles : null;

  return {
    serviceCents,
    fuelCents,
    totalCents,
    miles: usableMiles,
    centsPerMile: usableMiles != null ? totalCents / usableMiles : null,
  };
}
