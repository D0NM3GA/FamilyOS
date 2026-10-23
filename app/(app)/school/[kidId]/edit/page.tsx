import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { backLink, sectionTitle } from "@/components/styles";
import { ConfirmSubmit } from "@/components/submit";
import { addSchoolContact, removeSchoolContact, saveProfile } from "../../actions";
import { ContactForm, ProfileForm } from "../../forms";
import { requireAppOn } from "@/lib/app-guard";

export default async function EditSchoolProfilePage({ params }: { params: Promise<{ kidId: string }> }) {
  await requireAppOn("school");
  const viewer = await requireActiveProfile();
  if (!isAdult(viewer)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only grown-ups can edit school details.</p>
      </div>
    );
  }
  const { kidId } = await params;
  const person = await prisma.person.findFirst({
    where: { id: kidId, householdId: viewer.householdId, isHouseholdMember: true },
    select: {
      id: true,
      firstName: true,
      schoolProfile: { include: { contacts: { include: { person: { select: { id: true, firstName: true, lastName: true } } } } } },
    },
  });
  if (!person) notFound();
  const school = person.schoolProfile;
  const others = school
    ? await prisma.person.findMany({
        where: { householdId: viewer.householdId, isHouseholdMember: false, id: { notIn: school.contacts.map((c) => c.personId) } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: "asc" },
      })
    : [];

  return (
    <div className="p-4 sm:p-6">
      <Link href={`/school?kid=${person.id}`} className={backLink}>
        ← School
      </Link>
      <PageHeader className="mt-1" title={`🎒 ${person.firstName}'s school`} />
      <div className="mt-6">
        <ProfileForm action={saveProfile.bind(null, person.id)} defaults={school ?? undefined} />
      </div>

      {school && (
        <section className="mt-8 max-w-lg">
          <h2 className={sectionTitle}>Teachers & contacts</h2>
          {school.contacts.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-xl bg-card ring-1 ring-border">
              {school.contacts.map((c) => {
                const name = [c.person.firstName, c.person.lastName].filter(Boolean).join(" ");
                return (
                  <li key={c.personId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-bold text-foreground">{name}</span>{" "}
                      <span className="text-xs text-muted-foreground">{c.role}</span>
                    </span>
                    <form action={removeSchoolContact.bind(null, school.id, c.personId)}>
                      <ConfirmSubmit question={`Take ${name} off this school's contacts? They stay in People.`} yes="Remove" aria-label={`Remove ${name}`}>
                        Remove
                      </ConfirmSubmit>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3">
            <ContactForm
              action={addSchoolContact.bind(null, school.id)}
              contacts={others.map((o) => ({ id: o.id, name: [o.firstName, o.lastName].filter(Boolean).join(" ") }))}
            />
          </div>
        </section>
      )}
    </div>
  );
}
