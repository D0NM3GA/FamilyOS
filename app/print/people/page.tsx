import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { getHouseholdSettings } from "@/lib/household-settings";
import { fullName, listPeople, upcomingImportantDates, type PeopleFilter } from "@/lib/people";
import { formatFullDate } from "@/lib/format";
import { PrintEmpty, PrintRow, PrintSection, PrintShell, PrintTable, Td } from "@/components/print/print-shell";

export const metadata: Metadata = { title: "Contacts" };

const FILTER_LABEL: Record<PeopleFilter, string> = { all: "Everyone", member: "Household", contact: "Contacts" };
const UPCOMING_DAYS = 60;
const DATE_TYPE_LABEL = { BIRTHDAY: "Birthday", ANNIVERSARY: "Anniversary", OTHER: "Other" } as const;

/**
 * A contact sheet of whatever the /people list is showing (same ?q= and ?filter=, same
 * "all" default — the owner's call), plus upcoming important dates for those people. Leaks
 * nothing new to kids: /people is un-gated and already shows every phone/email. Private
 * `notes` are never printed — free text about a person is the last thing that belongs on
 * a fridge.
 */
export default async function PeoplePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const profile = await requireActiveProfile();
  const { q = "", filter: rawFilter } = await searchParams;
  const filter: PeopleFilter = rawFilter === "member" || rawFilter === "contact" ? rawFilter : "all";

  const [household, people, dates] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    listPeople(profile.householdId, { query: q, filter }),
    upcomingImportantDates(profile.householdId, UPCOMING_DAYS),
  ]);
  const printedIds = new Set(people.map((p) => p.id));
  const upcoming = dates.filter((d) => printedIds.has(d.personId));

  const backQuery = new URLSearchParams({ ...(q ? { q } : {}), ...(filter !== "all" ? { filter } : {}) }).toString();

  return (
    <PrintShell
      title="Contacts"
      subtitle={`${FILTER_LABEL[filter]}${q ? ` matching “${q}”` : ""}`}
      householdName={household.name}
      backHref={`/people${backQuery ? `?${backQuery}` : ""}`}
    >
      <PrintSection title={`People (${people.length})`}>
        {people.length === 0 ? (
          <PrintEmpty>No one matches.</PrintEmpty>
        ) : (
          <PrintTable head={["Name", "Phone", "Email", ""]}>
            {people.map((p) => (
              <PrintRow key={p.id}>
                <Td className="font-medium">{fullName(p)}</Td>
                <Td>{p.phone ?? "—"}</Td>
                <Td>{p.email ?? "—"}</Td>
                <Td className="text-stone-500">{p.isHouseholdMember ? "Household" : ""}</Td>
              </PrintRow>
            ))}
          </PrintTable>
        )}
      </PrintSection>

      {upcoming.length > 0 && (
        <PrintSection title={`Coming up (next ${UPCOMING_DAYS} days)`}>
          <PrintTable head={["Date", "Who", "What"]}>
            {upcoming.map((d) => (
              <PrintRow key={d.id}>
                <Td>{formatFullDate(d.next)}</Td>
                <Td>{fullName(d.person)}</Td>
                <Td>{d.label ?? DATE_TYPE_LABEL[d.type]}</Td>
              </PrintRow>
            ))}
          </PrintTable>
        </PrintSection>
      )}
    </PrintShell>
  );
}
