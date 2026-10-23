import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatInterval } from "@/lib/vehicles/format";
import { PageHeader } from "@/components/page-header";
import { btn, btnPrimary } from "@/components/styles";
import { setVehicleActive, setMaintenanceItemActive } from "../actions";
import { requireAppOn } from "@/lib/app-guard";
import { SubmitButton } from "@/components/submit";

export default async function ManageVehiclesPage() {
  const profile = await requireAppOn("cars");

  const vehicles = await prisma.vehicle.findMany({
    where: { householdId: profile.householdId },
    include: { maintenanceItems: { orderBy: [{ active: "desc" }, { title: "asc" }] } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Manage vehicles">
        <Link href="/vehicles/new" className={btnPrimary}>
          + New vehicle
        </Link>
      </PageHeader>

      {vehicles.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No vehicles yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-40">
                  <p
                    className={`truncate text-sm font-bold ${
                      vehicle.active ? "text-foreground" : "text-muted-foreground line-through"
                    }`}
                  >
                    {vehicle.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "No details"} ·{" "}
                    {vehicle.currentMileage.toLocaleString()} mi
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Link href={`/vehicles/${vehicle.id}/edit`} aria-label={`Edit ${vehicle.name}`} className={btn}>
                    Edit
                  </Link>
                  <Link href={`/vehicles/${vehicle.id}/items/new`} aria-label={`Add item to ${vehicle.name}`} className={btn}>
                    + Item
                  </Link>
                  <form action={setVehicleActive.bind(null, vehicle.id, !vehicle.active)}>
                    <SubmitButton
                      aria-label={`${vehicle.active ? "Deactivate" : "Reactivate"} ${vehicle.name}`}
                      className={btn}
                    >
                      {vehicle.active ? "Deactivate" : "Reactivate"}
                    </SubmitButton>
                  </form>
                </div>
              </div>

              {vehicle.maintenanceItems.length > 0 && (
                <ul className="divide-y divide-border border-t border-border">
                  {vehicle.maintenanceItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 pl-6 sm:pl-8">
                      <div className="min-w-0 flex-1 basis-40">
                        <p
                          className={`truncate text-sm font-medium ${
                            item.active ? "text-foreground" : "text-muted-foreground line-through"
                          }`}
                        >
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{formatInterval(item)}</p>
                      </div>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Link
                          href={`/vehicles/${vehicle.id}/items/${item.id}/edit`}
                          aria-label={`Edit ${item.title}`}
                          className={btn}
                        >
                          Edit
                        </Link>
                        <form action={setMaintenanceItemActive.bind(null, item.id, !item.active)}>
                          <SubmitButton
                            aria-label={`${item.active ? "Deactivate" : "Reactivate"} ${item.title}`}
                            className={btn}
                          >
                            {item.active ? "Deactivate" : "Reactivate"}
                          </SubmitButton>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
