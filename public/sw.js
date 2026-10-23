/*
 * The app's service worker. Phase 21.6: push notifications. Phase 44.2: the Shop list opens
 * without signal. It's plain JS outside the TypeScript build; lib/offline/sw.test.ts runs this
 * file in a fake worker.
 *
 * Offline rules (docs/PLAN.md, Phase 44.2):
 * - The Shop view asks for a save when it opens (OfflineWorker in app/(app)/groceries), however
 *   it was reached: Next's links change pages without a full page load. The worker fetches the
 *   page itself, without following redirects, so a sign-in bounce is never saved.
 * - Only a clean answer is saved: 200, same origin, HTML, and carrying the Shop list's own
 *   marker. The page streams, so an error screen or a redirect inside it still arrives as a
 *   200; only a page that rendered the list has the marker.
 * - The page and the /_next/static files it names are one saved copy, written to a new cache
 *   with the page last, and swapped in whole, so a half-saved copy never replaces a good one.
 * - Network first: the saved copy is used only when the network fails, replayed with its own
 *   headers so its script nonce and policy still match. It's dropped after 7 days, and the
 *   page clears it on sign-out (clearSavedCopies in lib/offline/worker.ts).
 * - Any other page load that fails gets a small self-contained "No signal" page, never data.
 */

const SHOP_PATH = "/groceries/shop";
const COPY_PREFIX = "shop-copy-";
const SAVED_AT = "x-familyos-saved-at";
// The attribute app/(app)/groceries/shop/page.tsx puts on the rendered list.
const SAVEABLE_MARK = "data-shop-saveable";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// A page names a few dozen chunks; anything past this is not a page this worker should save.
const MAX_ASSETS = 200;
// Pages opened from the saved copy, by their window's id: the page asks, to say it's the saved
// list. Capped, for pages that never ask (their script didn't run).
const fromCopy = new Set();
const MAX_FROM_COPY = 50;

self.addEventListener("install", () => {
  // Take over right away so an updated worker doesn't wait for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(event, url));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(request));
  }
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "save-shop") event.waitUntil(saveFromNetwork());
  if (type === "from-copy?" && event.ports && event.ports[0]) {
    const id = event.source && event.source.id;
    event.ports[0].postMessage({ fromCopy: fromCopy.has(id) });
    fromCopy.delete(id);
  }
});

function saveFromNetwork() {
  return oneAtATime(async () => {
    try {
      // "manual": a redirect (a sign-in bounce) comes back opaque, so it's never saved.
      const response = await fetch(SHOP_PATH, { headers: { accept: "text/html" }, redirect: "manual", cache: "no-store" });
      if (isCleanPage(response)) await writeCopy(response);
    } catch {
      // No signal: keep what's saved.
    }
  });
}

async function navigate(event, url) {
  try {
    return (await event.preloadResponse) || (await fetch(event.request));
  } catch {
    const copy = await savedPage();
    if (url.pathname === SHOP_PATH && copy) {
      if (event.resultingClientId) {
        if (fromCopy.size >= MAX_FROM_COPY) fromCopy.clear();
        fromCopy.add(event.resultingClientId);
      }
      return copy;
    }
    return noSignalPage(Boolean(copy));
  }
}

/** Network first, like pages: the saved files are only for when there's no signal. */
async function staticFile(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const name = await currentCopyName();
    const hit = name && (await caches.match(request, { cacheName: name }));
    if (hit) return hit;
    throw err;
  }
}

function isCleanPage(response) {
  const type = response.headers.get("content-type") || "";
  return response.status === 200 && response.type === "basic" && !response.redirected && type.startsWith("text/html");
}

/** The /_next/static files a page names: its scripts and styles, and those styles' fonts. */
function staticPaths(text) {
  const found = new Set();
  for (const match of text.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./~%]+/g)) {
    // RSC payloads escape slashes and quotes; a path never ends in a dot.
    found.add(match[0].replace(/\.+$/, ""));
  }
  // Files only: the runtime also names its chunk folder ("/_next/static/chunks/").
  return [...found].filter((p) => !p.includes("..") && /\.[A-Za-z0-9]+$/.test(p)).slice(0, MAX_ASSETS);
}

// One save at a time. Asked while one runs (it may be of an older list), the worker goes again
// from the network once it's done, so the newest list always wins.
let saving = null;
let saveAgain = false;
let lastStamp = 0;

function oneAtATime(save) {
  if (saving) {
    saveAgain = true;
    return saving;
  }
  saving = save()
    .catch(() => {})
    .finally(() => {
      saving = null;
      if (saveAgain) {
        saveAgain = false;
        return saveFromNetwork();
      }
    });
  return saving;
}

async function writeCopy(response) {
  const html = await response.text();
  if (!html.includes(SAVEABLE_MARK)) return;
  const headers = new Headers(response.headers);
  // The body is stored decoded, so the network's encoding and length no longer describe it.
  for (const h of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(h);
  headers.set(SAVED_AT, String(Date.now()));
  const page = new Response(html, { status: 200, statusText: response.statusText, headers });

  // Names sort by time and never repeat, even for two saves in the same millisecond.
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const name = COPY_PREFIX + lastStamp;
  const cache = await caches.open(name);
  try {
    const paths = staticPaths(html);
    const files = await Promise.all(paths.map((p) => fetch(p)));
    if (files.some((f) => !f.ok)) throw new Error("a static file didn't load");
    // A stylesheet's fonts live in /_next/static too; best effort, a missing font just falls back.
    const css = files.filter((f, i) => paths[i].endsWith(".css"));
    const fonts = (await Promise.all(css.map((f) => f.clone().text()))).flatMap(staticPaths).filter((p) => !paths.includes(p));
    await Promise.all(paths.map((p, i) => cache.put(p, files[i])));
    await Promise.all(
      fonts.map(async (p) => {
        const f = await fetch(p).catch(() => null);
        if (f && f.ok) await cache.put(p, f);
      }),
    );
    await cache.put(SHOP_PATH, page);
  } catch {
    await caches.delete(name);
    return;
  }
  // The new copy is whole: only now drop the older ones (only older, so two saves finishing
  // together can't delete each other).
  for (const key of await caches.keys()) {
    if (key.startsWith(COPY_PREFIX) && key < name) await caches.delete(key);
  }
}

/**
 * The newest whole saved copy's cache name, or null. The page is written last, so a copy without
 * it is still being saved (or was cut off) and is passed over, never served or deleted here; the
 * next whole save clears it. Copies older than 7 days are dropped. Reads go through
 * caches.match, which never makes a cache, so a lookup can't bring back one a save just deleted.
 */
async function currentCopyName() {
  const names = (await caches.keys()).filter((k) => k.startsWith(COPY_PREFIX)).sort().reverse();
  for (const name of names) {
    const page = await caches.match(SHOP_PATH, { cacheName: name });
    if (!page) continue;
    if (Date.now() - Number(page.headers.get(SAVED_AT)) < MAX_AGE_MS) return name;
    // This one and everything older is past its week.
    for (const old of names.slice(names.indexOf(name))) await caches.delete(old);
    return null;
  }
  return null;
}

async function savedPage() {
  const name = await currentCopyName();
  return name ? caches.match(SHOP_PATH, { cacheName: name }) : null;
}

/** No family data, no app name, no script: the strictest policy that still draws it. */
function noSignalPage(hasCopy) {
  const action = hasCopy
    ? `<a href="${SHOP_PATH}">Open the saved shopping list</a>`
    : `<a href="">Try again</a>`;
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>No signal</title>
<style>
  :root { color-scheme: light dark; --ink: #1f2933; --paper: #fffdf7; --accent: #b7e26b; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f5f3ee; --paper: #161b22; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--paper); color: var(--ink);
    font: 18px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 1.5rem; text-align: center; }
  h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
  a { display: inline-block; margin-top: 1rem; min-height: 44px; padding: .6rem 1.2rem; border: 2px solid var(--ink);
    border-radius: .75rem; background: var(--accent); color: #1f2933; font-weight: 800; text-decoration: none; }
  a:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
</style></head>
<body><main><h1>No signal</h1>
<p>${hasCopy ? "This page needs a connection. Your shopping list is saved on this device." : "This page needs a connection. Check your signal and try again."}</p>
${action}</main></body></html>`;
  return new Response(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "New alert";
  const body = typeof data.body === "string" ? data.body : "Something needs a look.";
  const path = typeof data.path === "string" ? data.path : "/";
  // Always show something: subscriptions are userVisibleOnly.
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/app-icon/192", data: { path } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.path;
  // Same-origin paths only ("//evil.com" is protocol-relative, so it's refused too).
  const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        try {
          await client.focus();
          await client.navigate(url.href);
          return;
        } catch {
          // An uncontrolled tab can't be navigated; fall through to a new window.
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
