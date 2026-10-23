import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { updateTaskDefinition } from "../../actions";
import { TaskDefinitionForm } from "../../task-definition-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditChorePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can edit chores.</p>
      </div>
    );
  }

  const { id } = await params;

  const [definition, householdMembers] = await Promise.all([
    prisma.taskDefinition.findFirst({
      where: { id, householdId: profile.householdId, domain: "CHORE" },
      include: { assignees: { omit: { photo: true } } },
    }),
    getHouseholdMembers(profile.householdId),
  ]);
  if (!definition) notFound();

  const members = householdMembers.map(({ id, firstName, lastName }) => ({
    id,
    firstName,
    lastName,
  }));

  return (
    <div className="p-4 sm:p-6">
      {/* Wraps rather than truncates: the name is the point of the heading, and one long
          word would otherwise push the page sideways on a phone. */}
      <PageHeader title={<span className="block break-words">Edit {definition.title}</span>} />
      <div className="mt-6">
        <TaskDefinitionForm
          action={updateTaskDefinition.bind(null, definition.id)}
          members={members}
          submitLabel="Save changes"
          cancelHref="/chores/manage"
          defaults={{
            title: definition.title,
            notes: definition.notes,
            frequencyType: definition.frequencyType,
            interval: definition.interval,
            daysOfWeek: definition.daysOfWeek,
            startDate: definition.startDate,
            points: definition.points,
            assignmentStrategy: definition.assignmentStrategy,
            assigneeIds: definition.assignees.map((a) => a.id),
            weatherSensitive: definition.weatherSensitive,
          }}
        />
      </div>
    </div>
  );
}
