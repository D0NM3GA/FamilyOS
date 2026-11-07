import { z } from "zod";
import { BULK_MAX } from "./bulk";

/** Phase 59.3: a bulk action's input, checked on the server: 1 to 30 ids, no repeats, a known action. */
export function bulkSchema<A extends readonly [string, ...string[]]>(actions: A) {
  return z.object({
    ids: z
      .array(z.string().min(1).max(64))
      .min(1, "Pick at least one.")
      .max(BULK_MAX, `At most ${BULK_MAX} at a time.`)
      .transform((ids) => [...new Set(ids)]),
    action: z.enum(actions),
    value: z.string().max(64).optional(),
  });
}
