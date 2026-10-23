"use client";

import { useEffect } from "react";
import { registerAppWorker } from "@/lib/offline/worker";

/**
 * Phase 44.2: the Groceries pages start the app's service worker for everyone (not only for
 * phone alerts), and the Shop view asks it to save the list for a dead spot (public/sw.js).
 * Best effort: a browser without service workers just needs signal, as before.
 */
export function OfflineWorker({ saveShop = false }: { saveShop?: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    registerAppWorker()
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (saveShop) reg.active?.postMessage({ type: "save-shop" });
      })
      .catch(() => {});
  }, [saveShop]);
  return null;
}
