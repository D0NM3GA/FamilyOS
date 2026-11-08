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
  // Phase 68a: a course's end, scheduled medicines only.
  endMode: z.enum(["never", "days", "date"]).default("never"),
  endDays: z.coerce.number().int("Days is a whole number").min(1, "At least 1 day").max(365, "At most 365 days").optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the last day")
    .transform((v) => {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    })
    .optional(),
  })
  .refine((v) => v.frequencyType === "AS_NEEDED" || v.timesOfDay.length > 0, { message: "Add at least one time", path: ["timesOfDay"] });

/**
 * Phase 68a: a course's last day (local midnight) from the form's end choice, or null when it
 * keeps going (or has no schedule to end). An error when the choice is incomplete or ends
 * before it starts.
 */
export function courseEnd(v: { frequencyType: string; startDate: Date; endMode: "never" | "days" | "date"; endDays?: number; endDate?: Date }): { endDate: Date | null } | { error: string } {
  if (v.frequencyType === "AS_NEEDED" || v.frequencyType === "ONCE" || v.endMode === "never") return { endDate: null };
  if (v.endMode === "days") {
    if (!v.endDays) return { error: "Say for how many days" };
    return { endDate: new Date(v.startDate.getFullYear(), v.startDate.getMonth(), v.startDate.getDate() + v.endDays - 1) };
  }
  if (!v.endDate) return { error: "Pick the last day" };
  if (v.endDate < v.startDate) return { error: "The last day can't be before it starts" };
  return { endDate: v.endDate };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 18", or "Jan 3, 2027" when it isn't this year (a course over New Year). */
export function courseDay(d: Date, now: Date = new Date()): string {
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day}, ${d.getFullYear()}`;
}
