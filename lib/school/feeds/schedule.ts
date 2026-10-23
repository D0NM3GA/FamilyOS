import { after } from "next/server";
import { captureError } from "@/lib/observability";
import { claimStaleFeeds, refreshFeed } from "./refresh";

/**
 * Called by /school and Home: claims every stale feed now (so a second visit can't also
 * start them), then refreshes them one by one after the page is sent. Unlike calendar
 * write-back this needs no one's token, so any visitor's page load keeps feeds fresh;
 * where it fetches from is set by an admin, and the lease plus the 6-hour rule bound how
 * often.
 */
export async function scheduleFeedRefresh(householdId: string): Promise<void> {
  const claimed = await claimStaleFeeds(householdId);
  if (claimed.length === 0) return;
  after(async () => {
    for (const id of claimed) {
      try {
        await refreshFeed(id);
      } catch {
        // Only the fact and the feed id: the original error can carry the feed's host or
        // its secret-bearing path.
        captureError(new Error(`school feed refresh failed (feed ${id})`));
      }
    }
  });
}
