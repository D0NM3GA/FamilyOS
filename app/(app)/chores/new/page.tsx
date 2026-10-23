import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers } from "@/lib/people";
import { PageHeader } from "@/components/page-header";
import { createTaskDefinition } from "../actions";
import { TaskDefinitionForm } from "../task-definition-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewChorePage() {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can create chores.</p>
      </div>
    );
  }

  const members = (await getHouseholdMembers(profile.householdId)).map(
    ({ id, firstName, lastName }) => ({ id, firstName, lastName }),
  );

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="New chore" />
      <div className="mt-6">
        <TaskDefinitionForm
          action={createTaskDefinition}
          members={members}
          submitLabel="Create chore"
          cancelHref="/chores"
        />
      </div>
    </div>
  );
}
