import { PageHeader } from "@/components/page-header";
import { createVehicle, lookUpVin } from "../actions";
import { VehicleForm } from "../vehicle-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewVehiclePage() {
  await requireAppOn("cars");

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="New vehicle" />
      <div className="mt-6">
        <VehicleForm action={createVehicle} submitLabel="Add vehicle" cancelHref="/vehicles" lookUpVin={lookUpVin} />
      </div>
    </div>
  );
}
