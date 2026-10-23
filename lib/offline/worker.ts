/**
 * The app's one service worker (public/sw.js): push alerts (Phase 21.6) and the Shop list
 * without signal (Phase 44.2). Browser-only helpers; every caller registers it the same way.
 */

/** Must match COPY_PREFIX in public/sw.js. */
export const SHOP_COPY_PREFIX = "shop-copy-";

export function registerAppWorker(): Promise<ServiceWorkerRegistration> {
  // updateViaCache "none": a new sw.js is picked up on the next visit, never a cached old one.
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/**
 * Drops the Shop list saved on this device. Signing out calls it (lib/auth-client.ts), so the
 * family's list doesn't stay behind on a device someone signed out of. Best effort: a browser
 * without Cache Storage (or with site data blocked) never had a saved copy.
 */
export async function clearSavedCopies(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    for (const name of await caches.keys()) {
      if (name.startsWith(SHOP_COPY_PREFIX)) await caches.delete(name);
    }
  } catch {
    // Nothing saved to clear.
  }
}
