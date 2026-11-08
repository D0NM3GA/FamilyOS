import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { getHouseholdSettings } from "@/lib/household-settings";
import { doseHistory, HISTORY_DAYS } from "@/lib/meds/history";
import {
  PrintEmpty,
  PrintRow,
  PrintSection,
  PrintShell,
  PrintTable,
  Td,
} from "@/components/print/print-shell";

export const metadata: Metadata = { title: "Dose history" };

/** Phase 65a: one medicine's last 90 days of doses on paper, for a doctor visit. Same access as the page. */
export default async function DoseHistoryPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();
  const { id } = await params;
  const [history, household] = await Promise.all([
    doseHistory(id, profile),
    getHouseholdSettings(profile.householdId),
  ]);
  if (!history) notFound();
  const { definition, days, taken } = history;
  const person = definition.assignees[0];
  const who = person
    ? [person.firstName, person.lastName].filter(Boolean).join(" ")
    : null;

  return (
    <PrintShell
      title={`${definition.title}: dose history`}
      subtitle={`${who ? `${who} · ` : ""}${taken} ${taken === 1 ? "dose" : "doses"} taken in the last ${HISTORY_DAYS} days`}
      householdName={household.name}
      backHref={`/meds/${definition.id}/history`}
    >
      {definition.notes && <p className="mt-2 text-sm">{definition.notes}</p>}
      <div className="mt-6">
        {days.length === 0 ? (
          <PrintEmpty>No doses in the last {HISTORY_DAYS} days.</PrintEmpty>
        ) : (
          days.map((d) => (
            <PrintSection key={d.day} title={d.day} keepTogether>
              <PrintTable head={["Time", "", "By"]}>
                {d.doses.map((x) => (
                  <PrintRow key={x.id}>
                    <Td className="w-24 tabular-nums">{x.time}</Td>
                    <Td>{x.what}</Td>
                    <Td>{x.who ?? ""}</Td>
                  </PrintRow>
                ))}
              </PrintTable>
            </PrintSection>
          ))
        )}
      </div>
    </PrintShell>
  );
}
