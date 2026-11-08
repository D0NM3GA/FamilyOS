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
export const medFormSchema = z
  .object({
  title: z.string().trim().min(1, "Title is required"),
  notes: z.string().trim().optional(),
  frequencyType: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "INTERVAL_DAYS", "DAYS_OF_WEEK", "AS_NEEDED"]),
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
  // At least one, except for an as-needed medicine (refined below), which has none.
  timesOfDay: z.array(z.string().regex(TIME_RE, "Times must be HH:MM")),
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
  // Phase 65a, as-needed only.
  minGapHours: z.coerce.number().min(0.5, "At least half an hour between doses").max(72, "At most 72 hours between doses").optional(),
  maxPerDay: z.coerce.number().int("Doses in 24 hours is a whole number").min(1, "At least 1 dose in 24 hours").max(24, "At most 24 doses in 24 hours").optional(),
  })
  .refine((v) => v.frequencyType === "AS_NEEDED" || v.timesOfDay.length > 0, { message: "Add at least one time", path: ["timesOfDay"] });
