import { PageHeader } from "@/components/page-header";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { createPerson } from "../actions";
import { PersonForm } from "../person-form";

export default async function NewPersonPage() {
  const profile = await requireActiveProfile();
  return (
    <div className="max-w-2xl p-4 sm:p-6">
      <PageHeader title="Add person" />
      <div className="mt-6">
        <PersonForm action={createPerson} defaults={isAdmin(profile) ? undefined : { adminOnly: true }} submitLabel="Add person" cancelHref="/people" />
      </div>
    </div>
  );
}
