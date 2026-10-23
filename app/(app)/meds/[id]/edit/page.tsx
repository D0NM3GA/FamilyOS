import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers, listPeople } from "@/lib/people";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { updateTaskDefinition } from "../../actions";
import { TaskDefinitionForm } from "../../task-definition-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditMedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can edit medications.</p>
      </div>
    );
  }

  const { id } = await params;

  const [definition, householdMembers, contactPeople] = await Promise.all([
    prisma.taskDefinition.findFirst({
      where: { id, householdId: profile.householdId, domain: "MED" },
      include: { assignees: { omit: { photo: true } }, medication: true },
    }),
    getHouseholdMembers(profile.householdId),
    listPeople(profile.householdId, { filter: "contact" }),
  ]);
  if (!definition) notFound();

  const members = householdMembers.map(({ id, firstName, lastName }) => ({
    id,
    firstName,
    lastName,
  }));
  const contacts = contactPeople.map(({ id, firstName, lastName }) => ({ id, firstName, lastName }));

  return (
    <div className="p-4 sm:p-6">
      {/* Wraps rather than truncates: the name is the point of the heading, and one long
          drug name would otherwise push the page sideways on a phone. */}
      <PageHeader title={<span className="block break-words">Edit {definition.title}</span>} />
      <div className="mt-6">
        <TaskDefinitionForm
          action={updateTaskDefinition.bind(null, definition.id)}
          members={members}
          contacts={contacts}
          submitLabel="Save changes"
          cancelHref="/meds/manage"
          defaults={{
            title: definition.title,
            notes: definition.notes,
            frequencyType: definition.frequencyType,
            interval: definition.interval,
            daysOfWeek: definition.daysOfWeek,
            startDate: definition.startDate,
            points: definition.points,
            timesOfDay: definition.timesOfDay,
            assigneeIds: definition.assignees.map((a) => a.id),
            quantityOnHand: definition.medication?.quantityOnHand ?? null,
            doseAmount: definition.medication?.doseAmount ?? null,
            refillThresholdQuantity: definition.medication?.refillThresholdQuantity ?? null,
            prescriberId: definition.medication?.prescriberId ?? null,
            pharmacyId: definition.medication?.pharmacyId ?? null,
          }}
        />
      </div>
    </div>
  );
}
