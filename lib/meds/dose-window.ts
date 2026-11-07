import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 60: a dose can be marked taken from its day on, never ahead: a stray tap on tomorrow's
 * dose in Upcoming gave its points and took its stock early. Today's later doses still can be
 * (an evening dose given at dinner). Same line as the board's Upcoming (lib/tasks/queries.ts
 * bucketInstances), on the household's clock (the server runs in its zone, lib/household-zone).
 */
export function canTakeYet(dueDate: Date, now: Date = new Date()): boolean {
  return dueDate < addDays(atMidnight(now), 1);
}
