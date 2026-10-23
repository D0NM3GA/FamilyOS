import { z } from "zod";

/** Phase 20 Sticker Store forms (grown-ups' reward, shelf and family-goal forms). */

const emoji = z
  .string()
  .trim()
  // 16, not 8: family and flag emoji are several code units joined together.
  .max(16, "Pick one emoji")
  .transform((v) => v || null);

const optionalId = z
  .string()
  .trim()
  .transform((v) => v || null);

export const rewardSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80, "Keep the title short"),
  pointCost: z.coerce
    .number()
    .int()
    .positive("Cost must be a positive number of points")
    .max(1_000_000, "That's a lot of points — pick something under 1,000,000"),
  emoji: emoji.prefault(""),
  bucketId: optionalId.prefault(""),
  /** "" = any time, otherwise 1–7 per rolling week. */
  limitPerWeek: z
    .union([z.literal(""), z.coerce.number().int().min(1, "At least 1 a week").max(7, "At most 7 a week")])
    .transform((v) => (v === "" ? null : v))
    .prefault(""),
  needsApproval: z.boolean().default(false),
});

export const bucketSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Keep the name short"),
  emoji: emoji.prefault(""),
});

export const familyGoalSchema = z.object({
  stickers: z
    .union([z.literal(""), z.coerce.number().int().positive("Pick a positive number").max(1_000_000)])
    .transform((v) => (v === "" ? null : v)),
  title: z
    .string()
    .trim()
    .max(80, "Keep it short")
    .transform((v) => v || null),
});
