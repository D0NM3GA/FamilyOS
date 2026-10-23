import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MAINTENANCE_TEMPLATES } from "@/lib/vehicles/templates";
import { formatInterval } from "@/lib/vehicles/format";
import { PageHeader } from "@/components/page-header";
import { addTemplateItems } from "../../../actions";
import { TemplatesForm } from "./templates-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function MaintenanceTemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireAppOn("cars");

  const { id } = await params;
  const vehicle = await prisma.vehicle.findFirst({
    where: { id, householdId: profile.householdId },
    include: { maintenanceItems: { select: { title: true } } },
  });
  if (!vehicle) notFound();

  const existing = new Set(vehicle.maintenanceItems.map((i) => i.title.trim().toLowerCase()));
  const options = MAINTENANCE_TEMPLATES.map((t) => ({
    key: t.key,
    title: t.title,
    intervalLabel: formatInterval(t),
    alreadyTracked: existing.has(t.title.toLowerCase()),
  }));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`Common maintenance for ${vehicle.name}`} />
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Pick what to track. These are typical intervals, not your car&apos;s — check the owner&apos;s manual and
        edit any item afterward.
      </p>
      <div className="mt-6">
        <TemplatesForm
          action={addTemplateItems.bind(null, vehicle.id)}
          options={options}
          skipHref={`/vehicles/${vehicle.id}`}
        />
      </div>
    </div>
  );
}
