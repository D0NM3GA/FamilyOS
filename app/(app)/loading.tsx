"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { RewardWord } from "@/components/family-look";
import { LOADING_TITLES, STORE_PATH } from "@/lib/loading-titles";

/**
 * Shown the moment someone taps an app on the rail, while the page is put together on the
 * server. Every page here is dynamic, and without this Next skips prefetching them and the
 * old page just sits there until the new one is ready. The fade waits a beat so a quick page
 * never flashes it.
 *
 * Phase 39: an app's landing page shows its own title straight away, in the same place the
 * page will (lib/loading-titles.ts); everything else keeps the untitled skeleton. One file at
 * the top, rather than one per app folder, because a folder's loading screen also covers every
 * page under it, and those have titles of their own.
 */
export default function Loading() {
  const pathname = usePathname();
  const title = LOADING_TITLES[pathname];
  const store = pathname === STORE_PATH;

  return (
    <div className="p-4 sm:p-6" aria-busy="true">
      {title && <PageHeader title={title} />}
      {/* The Store's own heading, as app/(app)/points/page.tsx draws it. */}
      {store && (
        <h1 className="text-4xl font-extrabold">
          <RewardWord form="store" />
        </h1>
      )}
      <p
        role="status"
        className={`animate-in fade-in fill-mode-backwards font-hand text-xl text-muted-foreground duration-300 ${title || store ? "mt-3" : ""}`}
        style={{ animationDelay: "200ms" }}
      >
        🐰 Hopping over…
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="animate-in fade-in fill-mode-backwards h-36 rounded-2xl bg-card ring-1 ring-border duration-300"
            style={{ animationDelay: `${200 + i * 60}ms` }}
          >
            <div className="m-4 h-5 w-1/2 animate-pulse rounded-full bg-muted" />
            <div className="mx-4 mt-3 h-3 w-3/4 animate-pulse rounded-full bg-muted" />
            <div className="mx-4 mt-2 h-3 w-2/3 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
