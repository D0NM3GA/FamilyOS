import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getPersonWithDetails, isDeletableContact } from "@/lib/people";
import { isMembershipLocked } from "@/lib/household-members";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { updatePerson } from "../../actions";
import { PersonForm } from "../../person-form";
import { DeletePersonButton } from "./delete-person-button";
import { signInKind } from "@/lib/sign-in-kind";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only adults can edit people.</p>
      </div>
    );
  }

  const { id } = await params;
  const person = await getPersonWithDetails(id, profile.householdId, { viewerIsAdult: true });
  if (!person) notFound();
  const jarCount = person.authUserId === null ? await prisma.moneyJarMember.count({ where: { personId: person.id } }) : 0;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title={`Edit ${person.firstName}`} />
      <div className="mt-6">
        <PersonForm
          action={updatePerson.bind(null, person.id)}
          // Narrowed to exactly what PersonForm reads — getPersonWithDetails' full row
          // (interactions, importantDates, and each interaction's full loggedBy Person)
          // would otherwise cross into this "use client" component's serialized props.
          defaults={{
            firstName: person.firstName,
            lastName: person.lastName,
            email: person.email,
            phone: person.phone,
            notes: person.notes,
            notesAdultsOnly: person.notesAdultsOnly,
            isHouseholdMember: person.isHouseholdMember,
            role: person.role,
            membershipLocked: isMembershipLocked({ ...person, jarCount }),
            onMicrosoft: (await signInKind(person)) === "microsoft",
            contactCadenceDays: person.contactCadenceDays,
            // Stored color only: null leaves every swatch unpicked, which keeps the
            // automatic color (lib/person-color.ts) instead of saving it on the next edit.
            color: person.color,
          }}
          submitLabel="Save changes"
          cancelHref={`/people/${person.id}`}
        />
      </div>
      {/* Members (and former members, who still have stickers, chores or a school record)
          leave through Settings → Household instead. */}
      {(await isDeletableContact(person.id, profile.householdId)) && (
        <div className="mt-10 max-w-xl rounded-2xl border-2 border-dashed border-destructive/40 p-4">
          <p className="text-sm text-muted-foreground">Not someone you keep in touch with anymore?</p>
          <div className="mt-2">
            <DeletePersonButton personId={person.id} name={person.firstName} />
          </div>
        </div>
      )}
    </div>
  );
}
