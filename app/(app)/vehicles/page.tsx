import Link from "next/link";
import { Suspense } from "react";
import { countLowSupplies, getVehiclesWithStatus } from "@/lib/vehicles/queries";
import { toISODate } from "@/lib/vehicles/dates";
import { MaintenanceItemCard } from "@/components/vehicles/maintenance-item-card";
import { OdometerForm } from "@/components/vehicles/odometer-form";
import { RecallChip } from "@/components/vehicles/recall-chip";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary } from "@/components/styles";
import { logMaintenanceDone, undoLastService, updateOdometer } from "./actions";
import { toCardItem } from "./card-item";
import { requireAppOn } from "@/lib/app-guard";

export default async function VehiclesPage() {
  const profile = await requireAppOn("cars");
  const [boards, lowSupplies] = await Promise.all([
    getVehiclesWithStatus(profile.householdId),
    countLowSupplies(profile.householdId),
  ]);
  const todayInputValue = toISODate(new Date());

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="🚗 Cars">
        <Link href="/vehicles/supplies" className={btn}>
          🧰 Garage
          {lowSupplies > 0 && (
            <span className="-rotate-1 rounded-md bg-sun px-1.5 text-xs font-bold text-ink">{lowSupplies} low</span>
          )}
        </Link>
        <>
          <Link href="/data#vehicles" className={btn}>
            Export
          </Link>
          <Link href="/vehicles/manage" className={btn}>
            Manage
          </Link>
          <Link href="/vehicles/new" className={btnPrimary}>
            + New vehicle
          </Link>
        </>
      </PageHeader>

      {boards.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No vehicles yet.{" "}
          <Link href="/vehicles/new" className="font-bold text-brand-text hover:underline">
            Add one
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {boards.map(({ vehicle, items }) => (
            <div key={vehicle.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-xl font-extrabold text-foreground">
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="inline-flex min-h-11 items-center hover:text-brand-text hover:underline sm:min-h-0"
                    >
                      {vehicle.name} →
                    </Link>
                    {/* Streams in after the board — never holds the page on NHTSA. */}
                    <Suspense fallback={null}>
                      <RecallChip vehicle={vehicle} />
                    </Suspense>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No details yet"}
                    {" · "}
                    {vehicle.currentMileage.toLocaleString()} mi
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OdometerForm
                    currentMileage={vehicle.currentMileage}
                    updateOdometer={updateOdometer.bind(null, vehicle.id)}
                  />
                  <Link href={`/vehicles/${vehicle.id}/items/new`} className={btn}>
                    + Add item
                  </Link>
                </div>
              </div>

              <ul className="mt-3 space-y-2">
                {items.length === 0 ? (
                  <li>
                    <p className="text-sm text-muted-foreground">
                      No maintenance items tracked yet.
                      <>
                        {" "}
                        <Link
                          href={`/vehicles/${vehicle.id}/items/templates`}
                          className="font-bold text-brand-text hover:underline"
                        >
                          Start from common items
                        </Link>
                      </>
                    </p>
                  </li>
                ) : (
                  items.map(({ item, due }) => (
                    <MaintenanceItemCard
                      key={item.id}
                      item={toCardItem(item, due, vehicle.currentMileage)}
                      viewerIsAdult
                      logDone={logMaintenanceDone.bind(null, item.id)}
                      undoLast={undoLastService.bind(null, item.id)}
                      todayInputValue={todayInputValue}
                    />
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
