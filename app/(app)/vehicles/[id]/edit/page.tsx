import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { updateVehicle } from "../../actions";
import { VehicleForm } from "../../vehicle-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAppOn("cars");

  const { id } = await params;
  const vehicle = await prisma.vehicle.findFirst({ where: { id, householdId: profile.householdId } });
  if (!vehicle) notFound();

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`Edit ${vehicle.name}`} />
      <p className="mt-1 text-xs text-muted-foreground">
        Correcting the mileage here overrides the odometer directly (unlike the board&apos;s quick update,
        it doesn&apos;t have to increase).
      </p>
      <div className="mt-6">
        <VehicleForm
          action={updateVehicle.bind(null, vehicle.id)}
          submitLabel="Save changes"
          cancelHref="/vehicles/manage"
          defaults={{
            name: vehicle.name,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            currentMileage: vehicle.currentMileage,
          }}
        />
      </div>
    </div>
  );
}
