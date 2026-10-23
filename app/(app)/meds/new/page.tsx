import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdMembers, listPeople } from "@/lib/people";
import { PageHeader } from "@/components/page-header";
import { createTaskDefinition } from "../actions";
import { TaskDefinitionForm } from "../task-definition-form";
import { requireAppOn } from "@/lib/app-guard";

export default async function NewMedPage() {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can add medications.</p>
      </div>
    );
  }

  const [members, contacts] = await Promise.all([
    getHouseholdMembers(profile.householdId).then((people) =>
      people.map(({ id, firstName, lastName }) => ({ id, firstName, lastName })),
    ),
    // Narrowed before crossing into the "use client" form — listPeople's full rows carry
    // email/phone/notes that a prescriber/pharmacy picker has no reason to serialize down.
    listPeople(profile.householdId, { filter: "contact" }).then((people) =>
      people.map(({ id, firstName, lastName }) => ({ id, firstName, lastName })),
    ),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="New medication" />
      <div className="mt-6">
        <TaskDefinitionForm
          action={createTaskDefinition}
          members={members}
          contacts={contacts}
          submitLabel="Add medication"
          cancelHref="/meds"
        />
      </div>
    </div>
  );
}
