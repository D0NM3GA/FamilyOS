import { z } from "zod";

/**
 * Pure rules for the garage supplies catalog (Phase 12.5): parsing the forms, "low", and
 * display text. The stock arithmetic itself runs in SQL (lib/vehicles/supply-stock.ts) so
 * it's atomic; nothing here reads the database.
 */

const MAX_QUANTITY = 100_000;

/** Supplies are counted in thirds of a quart and quarter-bottles, never finer. */
export function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Low at or below the threshold. Untracked stock, or no threshold, is never low. */
export function isSupplyLow(quantityOnHand: number | null, lowThreshold: number | null): boolean {
  if (quantityOnHand == null || lowThreshold == null) return false;
  return quantityOnHand <= lowThreshold;
}

/** "5 qt", "1 filter", "2.5". */
export function formatQuantity(n: number, unit: string | null): string {
  const value = Number.isInteger(n) ? String(n) : String(roundQuantity(n));
  return unit ? `${value} ${unit}` : value;
}

const optionalQuantity = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : Number(s)))
  .refine((n) => n === null || (Number.isFinite(n) && n >= 0 && n <= MAX_QUANTITY), "Enter a number, 0 or more")
  .transform((n) => (n === null ? null : roundQuantity(n)));

export const supplyFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  partNumber: z.string().trim().max(80).transform((s) => s || null),
  unit: z.string().trim().max(30).transform((s) => s || null),
  quantityOnHand: optionalQuantity,
  lowThreshold: optionalQuantity,
  notes: z.string().trim().max(2000).transform((s) => s || null),
});

export type SupplyFields = z.infer<typeof supplyFormSchema>;

export function parseSupplyForm(formData: FormData): { ok: true; fields: SupplyFields } | { ok: false; error: string } {
  const parsed = supplyFormSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    partNumber: String(formData.get("partNumber") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    quantityOnHand: String(formData.get("quantityOnHand") ?? ""),
    lowThreshold: String(formData.get("lowThreshold") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  return { ok: true, fields: parsed.data };
}

export type SupplyUse = { supplyId: string; quantity: number };

/**
 * The maintenance item form's "Uses" rows: parallel `useSupplyId` / `useQuantity` fields.
 * A row with no supply picked is ignored (the blank row the form always offers); a picked
 * supply needs a quantity above zero. The same supply twice is an error, not a sum: it's
 * almost certainly a mistake, and the table's key is (item, supply).
 */
export function parseSupplyUses(formData: FormData): { ok: true; uses: SupplyUse[] } | { ok: false; error: string } {
  const ids = formData.getAll("useSupplyId").map(String);
  const quantities = formData.getAll("useQuantity").map(String);
  const uses: SupplyUse[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const supplyId = ids[i].trim();
    if (!supplyId) continue;
    const quantity = Number((quantities[i] ?? "").trim());
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return { ok: false, error: "Each supply needs an amount above zero." };
    }
    if (seen.has(supplyId)) return { ok: false, error: "A supply is listed twice." };
    seen.add(supplyId);
    uses.push({ supplyId, quantity: roundQuantity(quantity) });
  }
  return { ok: true, uses };
}
