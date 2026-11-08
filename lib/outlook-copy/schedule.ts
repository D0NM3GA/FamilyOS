import { after } from "next/server";
import { captureError } from "@/lib/observability";
import { claimStaleCalendars, refreshOutlookCalendar } from "./copy";

/**
 * Phase 70a: Home and Calendar keep the Outlook copy fresh between background ticks. Claims every
 * stale calendar now (so a second visit can't also start them), then copies them after the page is
 * sent. Needs no one's sign-in: the app reads with its own token.
 */
export async function scheduleOutlookRefresh(householdId: string): Promise<void> {
  const claimed = await claimStaleCalendars(householdId);
  if (claimed.length === 0) return;
  after(async () => {
    for (const { id, lease } of claimed) {
      try {
        await refreshOutlookCalendar(id, { lease });
      } catch {
        // Only the fact and the id: an error could carry a mailbox.
        captureError(new Error(`outlook copy failed (calendar ${id})`));
      }
    }
  });
}
