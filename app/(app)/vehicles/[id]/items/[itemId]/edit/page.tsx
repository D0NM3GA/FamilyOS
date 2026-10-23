import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSupplyOptions } from "@/lib/vehicles/queries";
import { PageHeader } from "@/components/page-header";
import { updateMaintenanceItem } from "../../../../actions";
import { MaintenanceItemForm } from "../../../../item-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditMaintenanceItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const profile = await requireAppOn("cars");

  const { id, itemId } = await params;
  const item = await prisma.vehicleMaintenanceItem.findFirst({
    where: { id: itemId, vehicleId: id, vehicle: { householdId: profile.householdId } },
    include: { vehicle: true, supplies: true },
  });
  if (!item) notFound();
  const supplyOptions = await getSupplyOptions(
    profile.householdId,
    item.supplies.map((s) => s.supplyId),
  );

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`Edit ${item.title} — ${item.vehicle.name}`} />
      <div className="mt-6">
        <MaintenanceItemForm
          action={updateMaintenanceItem.bind(null, item.id)}
          submitLabel="Save changes"
          cancelHref="/vehicles/manage"
          supplyOptions={supplyOptions}
          defaults={{
            uses: item.supplies.map((s) => ({ supplyId: s.supplyId, quantity: s.quantity })),
            title: item.title,
            notes: item.notes,
            intervalMiles: item.intervalMiles,
            intervalMonths: item.intervalMonths,
          }}
        />
      </div>
    </div>
  );
}
