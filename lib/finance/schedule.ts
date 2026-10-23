import { after } from "next/server";
import { captureError } from "@/lib/observability";
import { claimConnections, syncConnection } from "./sync";

/**
 * Claims a jar's connections due for a sync now (so a second tab can't also start them) and
 * syncs them after the page is sent, the Phase 18.5 school-feed pattern. Returns how many
 * were started.
 */
export async function scheduleJarSync(jarId: string, opts: { force: boolean }): Promise<number> {
  const claimed = await claimConnections(jarId, opts);
  if (claimed.length === 0) return 0;
  after(async () => {
    for (const id of claimed) {
      try {
        await syncConnection(id);
      } catch {
        // Only the fact and the id: never amounts or descriptions.
        captureError(new Error(`money jar sync failed (connection ${id})`));
      }
    }
  });
  return claimed.length;
}
