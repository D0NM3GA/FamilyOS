import { prisma } from "@/lib/prisma";
import { isSetupReviewable } from "@/lib/setup-checklist";

/**
 * Phase 45.4: notes that an admin has been through a setup step the checklist can't infer
 * ("look", "apps"): the guided setup's Continue, or saving that page in Settings.
 */
export async function markSetupReviewed(householdId: string, step: string): Promise<void> {
  if (!isSetupReviewable(step)) return;
  const row = await prisma.household.findUnique({ where: { id: householdId }, select: { setupReviewed: true } });
  if (!row || row.setupReviewed.includes(step)) return;
  await prisma.household.update({ where: { id: householdId }, data: { setupReviewed: [...new Set([...row.setupReviewed, step])] } });
}
