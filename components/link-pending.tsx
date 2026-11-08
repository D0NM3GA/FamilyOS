"use client";

import { useLinkStatus } from "next/link";

/**
 * Phase 69a: put inside a <Link> to a heavy page (a person, a money jar, a car). While that link's
 * page is on its way, a thin bar runs along the top of the screen, so a tap on a slow phone shows
 * it was taken and isn't tapped again. Pages that open at once (prefetched, or with their own
 * loading screen) never show it.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden">
      <span className="block h-full w-1/3 animate-[link-pending_1s_ease-in-out_infinite] bg-brand motion-reduce:w-full motion-reduce:animate-none" />
    </span>
  );
}
