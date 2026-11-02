import { prisma } from "@/lib/prisma";

/** Who's already this household's prescriber or pharmacy, so those lists can start with them. */
export async function getMedContactsUsed(householdId: string) {
  const meds = await prisma.medication.findMany({
    where: { taskDefinition: { householdId }, OR: [{ prescriberId: { not: null } }, { pharmacyId: { not: null } }] },
    select: { prescriberId: true, pharmacyId: true },
  });
  return {
    prescriberIds: [...new Set(meds.flatMap((m) => m.prescriberId ?? []))],
    pharmacyIds: [...new Set(meds.flatMap((m) => m.pharmacyId ?? []))],
  };
}
