import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getHouseholdSettings } from "@/lib/household-settings";
import { fullName } from "@/lib/people";
import { prisma } from "@/lib/prisma";
import { describeRecurrence, formatHHmm } from "@/lib/tasks/format";
import { PrintEmpty, PrintRow, PrintSection, PrintShell, PrintTable, PrintToolbarLink, Td } from "@/components/print/print-shell";
import { requireAppOn } from "@/lib/app-guard";

export const metadata: Metadata = { title: "Medication list" };

/**
 * A medication list for a doctor visit or a babysitter, per person (?person=<id> for one
 * person's sheet). ADULT-ONLY (owner's call, Phase 13): stock counts and the med →
 * prescriber/pharmacy linkage are adult-only everywhere else (meds/manage, meds/[id]/edit),
 * and this would otherwise be the first kid-reachable surface for them. The /meds Print
 * link sits inside the board's adult-only controls for the same reason.
 */
export default async function MedsPrintPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  await requireAppOn("meds");
  const profile = await requireActiveProfile();

  if (!isAdult(profile)) {
    const { name } = await getHouseholdSettings(profile.householdId);
    return (
      <PrintShell title="Medication list" householdName={name} backHref="/meds">
        <div className="mt-6">
          <PrintEmpty>Only adults can print the medication list.</PrintEmpty>
        </div>
      </PrintShell>
    );
  }

  const { person } = await searchParams;
  const personRef = { select: { firstName: true, lastName: true, phone: true } } as const;
  const [household, definitions] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    prisma.taskDefinition.findMany({
      where: { householdId: profile.householdId, domain: "MED", active: true },
      select: {
        id: true,
        title: true,
        notes: true,
        frequencyType: true,
        interval: true,
        daysOfWeek: true,
        timesOfDay: true,
        assignees: { select: { id: true, firstName: true, lastName: true } },
        // Null for any med created before Phase 9 added the Medication row.
        medication: {
          select: { doseAmount: true, quantityOnHand: true, prescriber: personRef, pharmacy: personRef },
        },
      },
      orderBy: { title: "asc" },
    }),
  ]);

  // Group by who the med is for (its assignees). A med with several assignees is listed
  // under each of them, so any one person's sheet is complete on its own.
  type Def = (typeof definitions)[number];
  const groups = new Map<string, { name: string; defs: Def[] }>();
  for (const def of definitions) {
    const owners = def.assignees.length > 0 ? def.assignees : [null];
    for (const owner of owners) {
      const key = owner?.id ?? "";
      if (!groups.has(key)) groups.set(key, { name: owner ? fullName(owner) : "Unassigned", defs: [] });
      groups.get(key)!.defs.push(def);
    }
  }
  const sorted = [...groups.entries()].sort(([a, ga], [b, gb]) =>
    a === "" ? 1 : b === "" ? -1 : ga.name.localeCompare(gb.name),
  );
  const people = sorted.filter(([key]) => !person || key === person);

  const toolbar = (
    <>
      <PrintToolbarLink href="/print/meds" active={!person}>
        Everyone
      </PrintToolbarLink>
      {sorted
        .filter(([key]) => key !== "")
        .map(([key, g]) => (
          <PrintToolbarLink key={key} href={`/print/meds?person=${key}`} active={person === key}>
            {g.name}
          </PrintToolbarLink>
        ))}
    </>
  );

  const contact = (p: { firstName: string; lastName: string | null; phone: string | null } | null | undefined) =>
    p ? `${fullName(p)}${p.phone ? ` · ${p.phone}` : ""}` : "—";

  return (
    <PrintShell title="Medication list" householdName={household.name} backHref="/meds" toolbar={toolbar}>
      {people.length === 0 ? (
        <div className="mt-6">
          <PrintEmpty>No active medications.</PrintEmpty>
        </div>
      ) : (
        people.map(([key, group], index) => (
          <PrintSection key={key || "unassigned"} title={group.name} breakBefore={index > 0}>
            <PrintTable head={["Medication", "Dose / instructions", "Schedule", "On hand", "Prescriber", "Pharmacy"]}>
              {group.defs.map((def) => (
                <PrintRow key={def.id}>
                  <Td className="font-medium">{def.title}</Td>
                  <Td>
                    {def.medication?.doseAmount != null && <span className="block">{def.medication.doseAmount} per dose</span>}
                    {def.notes}
                  </Td>
                  <Td>
                    {describeRecurrence(def)}
                    {def.timesOfDay.length > 0 && (
                      <span className="block text-stone-600">{def.timesOfDay.map(formatHHmm).join(", ")}</span>
                    )}
                  </Td>
                  <Td>{def.medication?.quantityOnHand ?? "—"}</Td>
                  <Td>{contact(def.medication?.prescriber)}</Td>
                  <Td>{contact(def.medication?.pharmacy)}</Td>
                </PrintRow>
              ))}
            </PrintTable>
          </PrintSection>
        ))
      )}
    </PrintShell>
  );
}
