import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSupplyOptions } from "@/lib/vehicles/queries";
import { PageHeader } from "@/components/page-header";
import { createMaintenanceItem } from "../../../actions";
import { MaintenanceItemForm } from "../../../item-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewMaintenanceItemPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAppOn("cars");

  const { id } = await params;
  const vehicle = await prisma.vehicle.findFirst({ where: { id, householdId: profile.householdId } });
  if (!vehicle) notFound();
  const supplyOptions = await getSupplyOptions(profile.householdId);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`New item for ${vehicle.name}`} />
      <div className="mt-6">
        <MaintenanceItemForm
          action={createMaintenanceItem.bind(null, vehicle.id)}
          submitLabel="Add item"
          cancelHref="/vehicles"
          supplyOptions={supplyOptions}
        />
      </div>
    </div>
  );
}
