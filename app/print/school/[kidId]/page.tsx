import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getStudentHub } from "@/lib/school/queries";
import { PrintEmpty, PrintRow, PrintSection, PrintShell, PrintTable, Td } from "@/components/print/print-shell";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "School card" };

/**
 * A student's school fridge card (Phase 18): school, grade, getting there, lunch, schedule
 * and who to call. No grades or homework: this one goes on the fridge or to a sitter.
 * Visibility follows /school (a kid can print only their own).
 */
export default async function SchoolPrintPage({ params }: { params: Promise<{ kidId: string }> }) {
  await requireAppOn("school");
  const { kidId } = await params;
  const viewer = await requireActiveProfile();
  const hub = await getStudentHub(viewer, kidId);
  if (!hub?.person.schoolProfile) notFound();
  const { person } = hub;
  const school = person.schoolProfile!;
  const household = await getHouseholdSettings(viewer.householdId);

  const facts: [string, string | null][] = [
    ["School", school.schoolName],
    ["Grade", school.grade],
    ["School year", school.schoolYear],
    ["Getting there", school.transportNotes],
    ["Lunch", school.lunchNotes],
    ["Schedule", school.scheduleNotes],
    ["Notes", school.notes],
  ];

  return (
    <PrintShell title={`${person.firstName}'s school`} householdName={household.name} backHref={`/school?kid=${person.id}`}>
      <PrintSection title="The basics" keepTogether>
        <PrintTable head={["", ""]}>
          {facts
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <PrintRow key={label}>
                <Td className="w-32 font-semibold">{label}</Td>
                <Td className="whitespace-pre-line">{value}</Td>
              </PrintRow>
            ))}
        </PrintTable>
      </PrintSection>
      <PrintSection title="Who to call" keepTogether>
        {school.contacts.length === 0 ? (
          <PrintEmpty>No teachers or contacts added yet.</PrintEmpty>
        ) : (
          <PrintTable head={["Name", "Role", "Phone", "Email"]}>
            {school.contacts.map((c) => (
              <PrintRow key={c.personId}>
                <Td>{[c.person.firstName, c.person.lastName].filter(Boolean).join(" ")}</Td>
                <Td>{c.role}</Td>
                <Td>{c.person.phone}</Td>
                <Td>{c.person.email}</Td>
              </PrintRow>
            ))}
          </PrintTable>
        )}
      </PrintSection>
    </PrintShell>
  );
}
