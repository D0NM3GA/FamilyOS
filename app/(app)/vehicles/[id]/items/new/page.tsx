import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSupplyOptions } from "@/lib/vehicles/queries";
import { PageHeader } from "@/components/page-header";
import { createMaintenanceItem } from "../../../actions";
import { MaintenanceItemForm } from "../../../item-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewMaintenanceItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const profile = await requireAppOn("cars");

  const { id } = await params;
  // Phase 65b: ?kind=paperwork adds registration, inspection or insurance.
  const paperwork = (await searchParams).kind === "paperwork";
  const vehicle = await prisma.vehicle.findFirst({ where: { id, householdId: profile.householdId } });
  if (!vehicle) notFound();
  const supplyOptions = await getSupplyOptions(profile.householdId);

  return (
    <div className="max-w-2xl p-4 sm:p-6">
      <PageHeader title={paperwork ? `New paperwork for ${vehicle.name}` : `New item for ${vehicle.name}`} />
      <div className="mt-6">
        <MaintenanceItemForm
          action={createMaintenanceItem.bind(null, vehicle.id)}
          submitLabel={paperwork ? "Add paperwork" : "Add item"}
          cancelHref={paperwork ? `/vehicles/${vehicle.id}#paperwork` : "/vehicles"}
          supplyOptions={supplyOptions}
          paperwork={paperwork}
        />
      </div>
    </div>
  );
}
