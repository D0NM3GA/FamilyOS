import { prisma } from "@/lib/prisma";
import { daysLeftLabel } from "./supply";

/** Phase 62c: "about N days left" for each of a household's medicines with a count, by task definition id. */
export async function medicationDaysLeft(householdId: string): Promise<Map<string, string | null>> {
  const meds = await prisma.medication.findMany({
    where: { taskDefinition: { householdId, domain: "MED" } },
    select: { taskDefinitionId: true, quantityOnHand: true, doseAmount: true, taskDefinition: { select: { frequencyType: true, interval: true, daysOfWeek: true, timesOfDay: true } } },
  });
  return new Map(meds.map((m) => [m.taskDefinitionId, daysLeftLabel({ quantityOnHand: m.quantityOnHand, doseAmount: m.doseAmount, ...m.taskDefinition, interval: m.taskDefinition.interval ?? 1 })]));
}
