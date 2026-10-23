import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getVehicleDetail } from "@/lib/vehicles/queries";
import { computeMpg } from "@/lib/vehicles/mpg";
import { summarizeCosts, type CostWindow } from "@/lib/vehicles/costs";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/vehicles/dates";
import { formatFullDate, formatMpg } from "@/lib/vehicles/format";
import { MaintenanceItemCard } from "@/components/vehicles/maintenance-item-card";
import { FuelLogForm } from "@/components/vehicles/fuel-log-form";
import { RecallsSection } from "@/components/vehicles/recalls-section";
import { SmallActionButton } from "@/components/vehicles/small-action-button";
import { PageHeader } from "@/components/page-header";
import { backLink, btn, card, fieldLabel, sectionTitle } from "@/components/styles";
import { deleteFuelLog, logFuel, logMaintenanceDone, undoLastService } from "../actions";
import { toCardItem } from "../card-item";
import { requireAppOn } from "@/lib/app-guard";

type Detail = NonNullable<Awaited<ReturnType<typeof getVehicleDetail>>>;
type FuelLog = Detail["fuelLogs"][number];
type ServiceLog = Detail["serviceLogs"][number];

/**
 * One vehicle's hub: maintenance, NHTSA recalls, fill-ups + MPG, full service history,
 * and cost of ownership. Grown-ups only, like all of Cars (lib/app-guard.ts).
 */
export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAppOn("cars");
  const { id } = await params;

  const detail = await getVehicleDetail(profile.householdId, id);
  if (!detail) notFound();
  const { vehicle, items, serviceLogs, fuelLogs } = detail;
  // A deactivated (sold/retired) vehicle is read-only history (owner's call, Phase 12) —
  // the actions re-check this server-side too.
  const canLog = vehicle.active;

  const today = new Date();
  const todayInputValue = toISODate(today);
  // fuelLogs arrive newest-first by date; computeMpg re-sorts by mileage itself.
  const mpg = computeMpg(fuelLogs);
  const costs = summarizeCosts({
    service: serviceLogs.map((l) => ({ date: l.doneAt, mileage: l.mileage, costCents: l.costCents })),
    fuel: fuelLogs.map((l) => ({ date: l.filledAt, mileage: l.mileage, costCents: l.costCents })),
    currentMileage: vehicle.currentMileage,
    today,
  });

  const fuelColumns: Column<FuelLog>[] = [
    { head: "Date", cell: (log) => formatFullDate(log.filledAt) },
    { head: "Odometer", cell: (log) => log.mileage.toLocaleString() },
    { head: "Gallons", cell: (log) => log.gallons.toFixed(3) },
    { head: "Cost", cell: (log) => (log.costCents != null ? formatMoney(log.costCents) : "—") },
    {
      head: "MPG",
      cell: (log) => {
        const entry = mpg.perEntry.get(log.id);
        return entry?.anomaly ? "check mileage" : !log.fullTank ? "partial" : formatMpg(entry?.mpg ?? null);
      },
      tone: (log) => (mpg.perEntry.get(log.id)?.anomaly ? "text-amber-700 dark:text-amber-300" : undefined),
    },
    { head: "By", cell: (log) => log.loggedBy?.firstName ?? "—" },
  ];

  const serviceColumns: Column<ServiceLog>[] = [
    { head: "Date", cell: (log) => formatFullDate(log.doneAt) },
    { head: "Item", cell: (log) => log.item.title },
    { head: "Odometer", cell: (log) => log.mileage.toLocaleString() },
    { head: "Cost", cell: (log) => (log.costCents != null ? formatMoney(log.costCents) : "—") },
    { head: "Notes", cell: (log) => log.notes ?? "", wide: true },
    { head: "By", cell: (log) => log.loggedBy?.firstName ?? "—" },
  ];

  return (
    <div className="p-4 sm:p-6">
      <Link href="/vehicles" className={backLink}>
        ← Cars
      </Link>
      <PageHeader
        className="mt-1"
        title={
          <>
            🚗 {vehicle.name}
            {!vehicle.active && (
              <span className="ml-2 inline-block -rotate-1 rounded-md bg-muted px-1.5 align-middle text-xs font-bold text-muted-foreground">
                Inactive
              </span>
            )}
          </>
        }
      >
        <Link href={`/print/vehicles/${vehicle.id}`} className={btn}>
          Print
        </Link>
        <Link href={`/vehicles/${vehicle.id}/edit`} className={btn}>
          Edit
        </Link>
      </PageHeader>
      <p className="mt-1 text-sm text-muted-foreground">
        {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No details yet"}
        {" · "}
        {vehicle.currentMileage.toLocaleString()} mi
      </p>

      <Section title="Maintenance">
        {canLog && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Link href={`/vehicles/${vehicle.id}/items/new`} className={btn}>
              + Add item
            </Link>
            <Link href={`/vehicles/${vehicle.id}/items/templates`} className={btn}>
              + From common items
            </Link>
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance items tracked yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map(({ item, due }) => (
              <MaintenanceItemCard
                key={item.id}
                item={toCardItem(item, due, vehicle.currentMileage)}
                viewerIsAdult={canLog}
                logDone={logMaintenanceDone.bind(null, item.id)}
                undoLast={undoLastService.bind(null, item.id)}
                todayInputValue={todayInputValue}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Safety recalls" id="recalls">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Checking NHTSA…</p>}>
          <RecallsSection vehicle={vehicle} viewerIsAdult canAcknowledge={canLog} />
        </Suspense>
      </Section>

      <Section title="Fill-ups">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {canLog ? (
            <FuelLogForm
              logFuel={logFuel.bind(null, vehicle.id)}
              todayInputValue={todayInputValue}
              currentMileage={vehicle.currentMileage}
              showCost
            />
          ) : (
            <p className="text-sm text-muted-foreground">Inactive vehicle — reactivate it from Manage to log.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Average: <span className="font-bold text-foreground">{formatMpg(mpg.averageMpg)}</span> MPG
          </p>
        </div>
        {fuelLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fill-ups logged yet.</p>
        ) : (
          <LogTable
            rows={fuelLogs}
            columns={fuelColumns}
            actions={(log) => (
              <SmallActionButton
                action={deleteFuelLog.bind(null, log.id)}
                label="Delete"
                tone="danger"
                confirmText="Delete this fill-up? This can't be undone."
                ariaLabel={`Delete the ${formatFullDate(log.filledAt)} fill-up`}
              />
            )}
          />
        )}
      </Section>

      <Section title="Service history">
        {serviceLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No service logged yet.</p>
        ) : (
          <LogTable rows={serviceLogs} columns={serviceColumns} />
        )}
      </Section>

      <Section title="Cost of ownership">
        <div className="grid gap-3 sm:grid-cols-2">
          <CostCard label="Last 12 months" window={costs.last12Months} />
          <CostCard label="All time (logged)" window={costs.lifetime} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Only entries with a cost recorded count toward totals. Per-mile cost runs from the earliest logged
          odometer reading to today&apos;s.
        </p>
      </Section>
    </div>
  );
}

function CostCard({ label, window }: { label: string; window: CostWindow }) {
  return (
    <div className={card}>
      <p className={fieldLabel}>{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-foreground">{formatMoney(window.totalCents)}</p>
      <p className="text-xs text-muted-foreground">
        Service {formatMoney(window.serviceCents)} · Fuel {formatMoney(window.fuelCents)}
      </p>
      <p className="text-xs text-muted-foreground">
        {window.centsPerMile != null
          ? `${formatMoney(Math.round(window.centsPerMile))}/mi over ${window.miles!.toLocaleString()} mi`
          : "Not enough odometer readings for a per-mile cost"}
      </p>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-6">
      <h2 className={`mb-3 ${sectionTitle}`}>{title}</h2>
      {children}
    </section>
  );
}

/** One column of a log: its heading and what a row shows there. */
type Column<T> = {
  head: string;
  cell: (row: T) => React.ReactNode;
  tone?: (row: T) => string | undefined;
  /** Takes a whole line of the phone card (free text like notes). */
  wide?: boolean;
};

/**
 * A log as a table from `sm` up, and as one small card per entry on a phone, where six or
 * seven columns pushed Delete off-screen behind a sideways scroll. The first column titles
 * each card; empty cells are left off it.
 */
function LogTable<T extends { id: string }>({
  rows,
  columns,
  actions,
}: {
  rows: T[];
  columns: Column<T>[];
  actions?: (row: T) => React.ReactNode;
}) {
  const [first, ...rest] = columns;
  return (
    <>
      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl bg-card p-3 text-sm text-foreground ring-1 ring-border">
            <div className="flex items-start justify-between gap-3">
              <p className={`font-bold ${first.tone?.(row) ?? ""}`}>{first.cell(row)}</p>
              {actions?.(row)}
            </div>
            <dl className="mt-1 grid grid-flow-row-dense grid-cols-2 gap-x-3 gap-y-1">
              {rest.map((c) => {
                const value = c.cell(row);
                if (value == null || value === "") return null;
                return (
                  <div key={c.head} className={`min-w-0 ${c.wide ? "col-span-2" : ""}`}>
                    <dt className="text-xs text-muted-foreground">{c.head}</dt>
                    <dd className={`break-words ${c.tone?.(row) ?? ""}`}>{value}</dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl bg-card ring-1 ring-border sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.head} className={`px-3 py-2 ${fieldLabel}`}>
                  {c.head}
                </th>
              ))}
              {actions && (
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="text-foreground">
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c.head} className={`px-3 py-2 align-top ${c.tone?.(row) ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && <td className="px-3 py-2 align-top">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
