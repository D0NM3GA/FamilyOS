import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Phase 63a: finishing a trip asks how many were picked up of a list item that a medicine or a
 * car supply put there, and adds that to its stock (the owner's call). Only a grown-up asks and
 * restocks: those counts are grown-up things (Meds' Manage, the Garage).
 */

export type RestockQuestion = { itemId: string; name: string; onHand: number; unit: string | null };

/** What to ask about: done items on the active list with a source whose stock is counted. */
export async function restockQuestions(listId: string, householdId: string): Promise<RestockQuestion[]> {
  const rows = await prisma.shoppingListItem.findMany({
    where: { listId, done: true, OR: [{ medicationId: { not: null } }, { vehicleSupplyId: { not: null } }] },
    select: {
      id: true,
      product: { select: { name: true } },
      medication: { select: { quantityOnHand: true, taskDefinition: { select: { householdId: true } } } },
      vehicleSupply: { select: { quantityOnHand: true, unit: true, householdId: true, active: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((r): RestockQuestion[] => {
    if (r.medication && r.medication.taskDefinition.householdId === householdId && r.medication.quantityOnHand != null) {
      return [{ itemId: r.id, name: r.product.name, onHand: r.medication.quantityOnHand, unit: null }];
    }
    if (r.vehicleSupply && r.vehicleSupply.householdId === householdId && r.vehicleSupply.active && r.vehicleSupply.quantityOnHand != null) {
      return [{ itemId: r.id, name: r.product.name, onHand: r.vehicleSupply.quantityOnHand, unit: r.vehicleSupply.unit }];
    }
    return [];
  });
}

export const restockSchema = z
  .array(z.object({ itemId: z.string().min(1).max(64), amount: z.number().finite().min(0).max(10_000) }))
  .max(200);

export type Restock = z.infer<typeof restockSchema>;

/** Restocks worth applying: positive amounts, one per item (the last one given wins). Pure. */
export function cleanRestock(input: Restock): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of input) {
    if (r.amount > 0) out.set(r.itemId, Math.round(r.amount * 1000) / 1000);
    else out.delete(r.itemId);
  }
  return out;
}
