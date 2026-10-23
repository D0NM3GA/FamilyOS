import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getVehicleDetail, getVehicleRecalls } from "@/lib/vehicles/queries";
import { computeMpg } from "@/lib/vehicles/mpg";
import { summarizeCosts, type CostWindow } from "@/lib/vehicles/costs";
import { formatMoney } from "@/lib/money";
import {
  formatDueDetail,
  formatFullDate,
  formatInterval,
  formatISODate,
  formatLastDoneDetail,
  formatMpg,
} from "@/lib/vehicles/format";
import { PrintEmpty as Empty, PrintSection, PrintShell, PrintTable, Td } from "@/components/print/print-shell";
import { requireAppOn } from "@/lib/app-guard";

// Browsers print the document title in the page header/footer.
export const metadata: Metadata = { title: "Vehicle record" };

/**
 * Printable vehicle record (for a mechanic, or selling the car). Grown-ups only, like the
 * detail page. See components/print/print-shell.tsx for why /print/** sits outside (app).
 */
export default async function VehiclePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAppOn("cars");
  const { id } = await params;

  const detail = await getVehicleDetail(profile.householdId, id);
  if (!detail) notFound();
  const { vehicle, items, serviceLogs, fuelLogs } = detail;

  const today = new Date();
  const household = await getHouseholdSettings(profile.householdId);
  // Awaited directly (no Suspense): a print page should be complete before anyone prints it.
  const recalls = await getVehicleRecalls(vehicle);
  const mpg = computeMpg(fuelLogs);
  const costs = summarizeCosts({
    service: serviceLogs.map((l) => ({ date: l.doneAt, mileage: l.mileage, costCents: l.costCents })),
    fuel: fuelLogs.map((l) => ({ date: l.filledAt, mileage: l.mileage, costCents: l.costCents })),
    currentMileage: vehicle.currentMileage,
    today,
  });
  const totalGallons = fuelLogs.reduce((sum, l) => sum + l.gallons, 0);

  return (
    <PrintShell
      title={vehicle.name}
      subtitle={`${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"} · ${vehicle.currentMileage.toLocaleString()} mi`}
      householdName={household.name}
      backHref={`/vehicles/${vehicle.id}`}
    >
      <PrintSection keepTogether title="Maintenance schedule">
        {items.length === 0 ? (
          <Empty>No maintenance items tracked.</Empty>
        ) : (
          <PrintTable head={["Item", "Interval", "Last done", "Status"]}>
            {items.map(({ item, due }) => (
              <tr key={item.id} className="border-t border-stone-200">
                <Td>{item.title}</Td>
                <Td>{formatInterval(item)}</Td>
                <Td>{formatLastDoneDetail(item) ?? "Never"}</Td>
                <Td>
                  {due.status === "OVERDUE" ? "Overdue" : due.status === "UPCOMING" ? "Due soon" : "OK"}
                  {formatDueDetail(due) ? ` — ${formatDueDetail(due)}` : ""}
                </Td>
              </tr>
            ))}
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection keepTogether title="Open safety recalls (NHTSA)">
        {recalls.status === "ok" ? (
          recalls.open.length === 0 ? (
            <Empty>None open.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {recalls.open.map((r) => (
                <li key={r.campaignNumber}>
                  <span className="font-semibold">#{r.campaignNumber}</span> {r.component}
                  {r.reportReceivedDate ? ` (${formatISODate(r.reportReceivedDate)})` : ""}
                  {r.parkIt ? " — DO NOT DRIVE" : r.parkOutSide ? " — PARK OUTSIDE" : ""}
                  <p className="text-xs text-stone-600">{r.summary}</p>
                </li>
              ))}
            </ul>
          )
        ) : (
          <Empty>Recall status couldn&apos;t be checked — see the app for details.</Empty>
        )}
      </PrintSection>

      <PrintSection keepTogether title="Service history">
        {serviceLogs.length === 0 ? (
          <Empty>No service logged.</Empty>
        ) : (
          <PrintTable head={["Date", "Item", "Odometer", "Cost", "Notes"]}>
            {serviceLogs.map((log) => (
              <tr key={log.id} className="border-t border-stone-200">
                <Td>{formatFullDate(log.doneAt)}</Td>
                <Td>{log.item.title}</Td>
                <Td>{log.mileage.toLocaleString()}</Td>
                <Td>{log.costCents != null ? formatMoney(log.costCents) : "—"}</Td>
                <Td>{log.notes ?? ""}</Td>
              </tr>
            ))}
          </PrintTable>
        )}
      </PrintSection>

      <PrintSection keepTogether title="Fuel">
        <p className="text-sm">
          {fuelLogs.length} fill-up{fuelLogs.length === 1 ? "" : "s"} · {totalGallons.toFixed(1)} gal · average{" "}
          {formatMpg(mpg.averageMpg)} MPG
        </p>
      </PrintSection>

      <PrintSection keepTogether title="Cost of ownership">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <CostBlock label="Last 12 months" window={costs.last12Months} />
          <CostBlock label="All time (logged)" window={costs.lifetime} />
        </div>
      </PrintSection>
    </PrintShell>
  );
}

function CostBlock({ label, window }: { label: string; window: CostWindow }) {
  return (
    <div>
      <p className="font-semibold">
        {label}: {formatMoney(window.totalCents)}
      </p>
      <p className="text-stone-600">
        Service {formatMoney(window.serviceCents)} · Fuel {formatMoney(window.fuelCents)}
        {window.centsPerMile != null ? ` · ${formatMoney(Math.round(window.centsPerMile))}/mi` : ""}
      </p>
    </div>
  );
}
