"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Away at least this long before coming back refreshes the page. */
export const AWAY_MS = 60_000;

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Whether coming back to the page should refresh it: online, and either away a minute or more or
 * a new day since it was last fresh. Pure, for tests.
 */
export function shouldRefresh(o: { hiddenAt: number | null; freshDay: string; now: Date; online: boolean }): boolean {
  if (!o.online) return false;
  if (dayOf(o.now) !== o.freshDay) return true;
  return o.hiddenAt !== null && o.now.getTime() - o.hiddenAt >= AWAY_MS;
}

/**
 * Phase 69a: an installed app or a kitchen tablet reopened the next morning showed yesterday's
 * chores and doses, with no reload button to fix it. This refreshes the page's data (React keeps
 * what's on screen, typed text included) when it's shown again after a minute away, or when the day
 * has turned while it was open (the device's day, which is the family's except on a trip).
 * `everyMs` also refreshes on a timer while it's shown (the Shop view).
 */
export function RefreshOnReturn({ everyMs }: { everyMs?: number }) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const freshDay = useRef(dayOf(new Date()));

  useEffect(() => {
    const refresh = () => {
      hiddenAt.current = null;
      freshDay.current = dayOf(new Date());
      router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      if (shouldRefresh({ hiddenAt: hiddenAt.current, freshDay: freshDay.current, now: new Date(), online: navigator.onLine })) refresh();
      // Shown again offline: kept, so coming back online soon after still refreshes.
      else if (navigator.onLine) hiddenAt.current = null;
    };
    const onOnline = () => {
      if (document.visibilityState === "visible" && shouldRefresh({ hiddenAt: hiddenAt.current, freshDay: freshDay.current, now: new Date(), online: true })) refresh();
    };
    // Shown all night (a tablet on the counter): the day turning refreshes too.
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const now = new Date();
      if (everyMs || shouldRefresh({ hiddenAt: null, freshDay: freshDay.current, now, online: navigator.onLine })) {
        if (navigator.onLine) refresh();
      }
    };
    const timer = window.setInterval(tick, everyMs ?? AWAY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [router, everyMs]);

  return null;
}
