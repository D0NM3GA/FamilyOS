import { PageHeader } from "@/components/page-header";
import { createSupply } from "../actions";
import { SupplyForm } from "../supply-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewSupplyPage() {
  await requireAppOn("cars");
  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="New garage supply" />
      <div className="mt-6">
        <SupplyForm action={createSupply} submitLabel="Add supply" />
      </div>
    </div>
  );
}
