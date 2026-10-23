import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Lives here, not in the "use server" app/(app)/meds/actions.ts that uses it, so it's
 * unit-testable — a "use server" file may only export async functions, not a schema
 * object (same reason lib/people.ts's relationshipInputSchema was moved out of
 * app/(app)/people/[id]/actions.ts in Phase 8).
 *
 * A medication is for one person — no ROUND_ROBIN/LEAST_ASSIGNED rotation here (unlike
 * chores), so there's no strategy field and this always pairs with assignmentStrategy:
 * "FIXED" and exactly one assignee.
 */
export const medFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  notes: z.string().trim().optional(),
  frequencyType: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "INTERVAL_DAYS", "DAYS_OF_WEEK"]),
  interval: z.coerce.number().int().min(1).optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date")
    .transform((v) => {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
  points: z.coerce.number().int().min(0),
  timesOfDay: z.array(z.string().regex(TIME_RE, "Times must be HH:MM")).min(1, "Add at least one time"),
  assigneeIds: z.array(z.string()).length(1, "Pick who this is for"),
  // Stock tracking is all-or-nothing in spirit (doseConsumption in lib/meds/quantity.ts
  // treats a missing quantityOnHand OR doseAmount as "not tracking"), but each field is
  // independently optional here — a household can set a refill threshold before they've
  // counted what's on hand, for instance, and that's fine; it just won't decrement yet.
  quantityOnHand: z.coerce.number().min(0).optional(),
  doseAmount: z.coerce.number().positive().optional(),
  refillThresholdQuantity: z.coerce.number().min(0).optional(),
  prescriberId: z.string().trim().optional(),
  pharmacyId: z.string().trim().optional(),
});
