"use client";

import dynamic from "next/dynamic";

/**
 * Phase 61: Bunson's code (the biggest client component) is fetched only when he's chatty. A
 * statically imported client component ships with the route even when it doesn't render
 * (Next's lazy-loading guide), so the layout imports this instead. No server render: he lives
 * in the corner and talks after the page is up.
 */
export const LazyBunson = dynamic(() => import("./bunson").then((m) => m.Bunson), { ssr: false });
