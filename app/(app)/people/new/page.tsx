import { PageHeader } from "@/components/page-header";
import { createPerson } from "../actions";
import { PersonForm } from "../person-form";

export default function NewPersonPage() {
  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Add person" />
      <div className="mt-6">
        <PersonForm action={createPerson} submitLabel="Add person" cancelHref="/people" />
      </div>
    </div>
  );
}
