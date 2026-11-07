"use client";

import { useEffect } from "react";
import { markShownRead } from "../notification-actions";

/**
 * Phase 60: once the Notifications page has shown its unread pings (in bold, this visit), they
 * count as read. Nothing to see; the bell's next poll picks up the new count.
 */
export function MarkShown({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    markShownRead(key.split(",")).catch(() => {});
  }, [key]);
  return null;
}
