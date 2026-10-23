import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { updateSupply } from "../../actions";
import { SupplyForm } from "../../supply-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditSupplyPage({ params }: { params: Promise<{ supplyId: string }> }) {
  const profile = await requireAppOn("cars");
  const { supplyId } = await params;
  const supply = await prisma.vehicleSupply.findFirst({ where: { id: supplyId, householdId: profile.householdId } });
  if (!supply) notFound();

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`Edit ${supply.name}`} />
      <div className="mt-6">
        <SupplyForm action={updateSupply.bind(null, supply.id)} submitLabel="Save changes" defaults={supply} />
      </div>
    </div>
  );
}
