import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, test } from "vitest";
import { SHOP_COPY_PREFIX } from "./worker";

/**
 * Phase 44.2: public/sw.js's offline rules, run in a made-up worker (Node's own Request,
 * Response and Headers; an in-memory Cache Storage; a fetch each test scripts). The browser
 * test (e2e/smoke.spec.ts) covers the same path end to end; this covers the refusals it can't
 * easily stage (a sign-in bounce, a data-only answer, a half-saved copy, a week-old copy).
 */
const ORIGIN = "https://app.test";
const SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "..", "public", "sw.js"), "utf8");
const DAY = 24 * 60 * 60 * 1000;

type Req = { url: string; method: string; mode: string };
type Handler = (event: unknown) => void;

function fakeCaches() {
  const store = new Map<string, Map<string, Response>>();
  const key = (k: string | Req) => new URL(typeof k === "string" ? k : k.url, ORIGIN).href;
  return {
    store,
    async keys() {
      return [...store.keys()];
    },
    async delete(name: string) {
      return store.delete(name);
    },
    // Like the real one, never makes a cache.
    async match(k: string | Req, opts: { cacheName?: string } = {}) {
      const names = opts.cacheName ? [opts.cacheName] : [...store.keys()];
      for (const n of names) {
        const hit = store.get(n)?.get(key(k));
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return {
        async match(k: string | Req) {
          return c.get(key(k))?.clone();
        },
        async put(k: string | Req, res: Response) {
          c.set(key(k), res);
        },
      };
    },
  };
}

/** A response as a browser's fetch gives it: same-origin ("basic"), maybe redirected. */
function served(body: string, init: ResponseInit & { redirected?: boolean; type?: string } = {}) {
  const res = new Response(body, init);
  Object.defineProperty(res, "type", { value: init.type ?? "basic" });
  Object.defineProperty(res, "redirected", { value: init.redirected ?? false });
  return res;
}

const html = (body: string, headers: Record<string, string> = {}) =>
  served(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "script-src 'nonce-abc'", ...headers },
  });

const SHOP_HTML = `<!doctype html><link rel="stylesheet" href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js" nonce="abc"></script>
<script nonce="abc">self.__next_f.push([1,"[\\"/_next/static/chunks/shop.js\\",\\"/_next/static/chunks/\\"]"])</script><div data-shop-saveable=""><p>Eggs</p></div>`;

let worker: {
  handlers: Map<string, Handler>;
  caches: ReturnType<typeof fakeCaches>;
  online: boolean;
  routes: Map<string, () => Response>;
  fetched: { url: string; init?: RequestInit }[];
  now: number;
};

beforeEach(() => {
  const handlers = new Map<string, Handler>();
  const caches = fakeCaches();
  const state = { handlers, caches, online: true, routes: new Map<string, () => Response>(), fetched: [] as { url: string; init?: RequestInit }[], now: Date.UTC(2026, 9, 22) };
  state.routes.set("/_next/static/css/app.css", () => served("body{font-family:x;src:url(/_next/static/media/font.woff2)}", { headers: { "content-type": "text/css" } }));
  state.routes.set("/_next/static/chunks/main.js", () => served("main()"));
  state.routes.set("/_next/static/chunks/shop.js", () => served("shop()"));
  state.routes.set("/_next/static/media/font.woff2", () => served("font"));
  state.routes.set("/groceries/shop", () => html(SHOP_HTML));
  const fakeFetch = async (input: string | Req, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    state.fetched.push({ url: url.pathname, init });
    if (!state.online) throw new TypeError("Failed to fetch");
    const route = state.routes.get(url.pathname);
    return route ? route() : served("not found", { status: 404, headers: { "content-type": "text/html" } });
  };
  const self = {
    location: new URL(ORIGIN),
    registration: { navigationPreload: null },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
  };
  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fakeFetch,
    Response,
    Headers,
    URL,
    Date: { now: () => state.now },
  });
  worker = state;
});

/** Runs a fetch event; returns what the worker answered (undefined: left to the browser). */
async function dispatch(pathname: string, mode = "navigate", resultingClientId = "") {
  let answer: Promise<Response> | undefined;
  const waits: Promise<unknown>[] = [];
  worker.handlers.get("fetch")!({
    resultingClientId,
    request: { url: ORIGIN + pathname, method: "GET", mode },
    preloadResponse: Promise.resolve(undefined),
    respondWith: (p: Promise<Response>) => (answer = p),
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  const res = await answer;
  await Promise.all(waits);
  return res;
}

async function message(data: unknown, clientId = "") {
  const waits: Promise<unknown>[] = [];
  const replies: unknown[] = [];
  worker.handlers.get("message")!({
    data,
    source: { id: clientId },
    ports: [{ postMessage: (m: unknown) => replies.push(m) }],
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  await Promise.all(waits);
  return replies[0];
}

const copies = () => [...worker.caches.store.keys()].filter((k) => k.startsWith(SHOP_COPY_PREFIX));
const savedPaths = () => [...worker.caches.store.get(copies()[0])!.keys()].map((k) => new URL(k).pathname).sort();

const save = () => message({ type: "save-shop" });

describe("saving the Shop list", () => {
  test("the Shop view asks, and the worker saves the page with the static files it names, and their fonts", async () => {
    await save();
    expect(copies()).toHaveLength(1);
    expect(savedPaths()).toEqual([
      "/_next/static/chunks/main.js",
      "/_next/static/chunks/shop.js",
      "/_next/static/css/app.css",
      "/_next/static/media/font.woff2",
      "/groceries/shop",
    ]);
    expect(worker.fetched.find((f) => f.url === "/groceries/shop")?.init).toMatchObject({ redirect: "manual" });
  });

  test("a page load alone saves nothing (the page's own request does), and a data-only answer is left alone", async () => {
    await dispatch("/groceries/shop");
    expect(await dispatch("/groceries/shop", "cors")).toBeUndefined();
    expect(copies()).toEqual([]);
  });

  test.each([
    ["a sign-in bounce", () => served("", { status: 0, type: "opaqueredirect" })],
    ["a redirect followed to another page", () => served("<p>Who's here?</p>", { status: 200, redirected: true, headers: { "content-type": "text/html" } })],
    ["an error page", () => served("oops", { status: 500, headers: { "content-type": "text/html" } })],
    ["something that isn't HTML", () => served("{}", { status: 200, headers: { "content-type": "application/json" } })],
    // The page streams: Next fixes the status at 200 before an error screen or a redirect inside it.
    ["a streamed error screen", () => html(SHOP_HTML.replace('<div data-shop-saveable=""><p>Eggs</p></div>', "<h2>Something went wrong</h2>"))],
    ["a streamed redirect", () => html('<p>Hopping over…</p><meta id="__next-page-redirect" content="/apps-off/groceries">')],
  ])("never saves %s", async (_, answer) => {
    worker.routes.set("/groceries/shop", answer);
    await save();
    expect(copies()).toEqual([]);
  });

  test("a streamed error screen never replaces a good copy", async () => {
    await save();
    const good = copies();
    worker.now += 60_000;
    worker.routes.set("/groceries/shop", () => html("<h2>Something went wrong</h2>"));
    await save();
    expect(copies()).toEqual(good);
  });

  test("the stored page drops the network's encoding and length, which no longer describe its body", async () => {
    worker.routes.set("/groceries/shop", () => html(SHOP_HTML, { "content-encoding": "gzip", "content-length": "12" }));
    await save();
    worker.online = false;
    const res = (await dispatch("/groceries/shop"))!;
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.text()).toContain("<p>Eggs</p>");
  });

  test("a copy missing a file never replaces a whole one", async () => {
    await save();
    const good = copies();
    worker.now += 60_000;
    worker.routes.delete("/_next/static/chunks/shop.js");
    await save();
    expect(copies()).toEqual(good);
  });

  test("a copy still being saved is passed over, and the whole one it will replace still opens", async () => {
    await save();
    const good = copies()[0];
    // A save in progress: its cache exists, its page isn't written yet.
    worker.caches.store.set(`${SHOP_COPY_PREFIX}${worker.now + 60_000}`, new Map());
    worker.online = false;
    expect(await (await dispatch("/groceries/shop"))!.text()).toContain("<p>Eggs</p>");
    expect(copies()).toContain(good);
  });

  test("a newer whole copy replaces the old one", async () => {
    await save();
    const first = copies();
    worker.now += 60_000;
    await save();
    expect(copies()).toHaveLength(1);
    expect(copies()).not.toEqual(first);
  });

  test("asked again after the list changed, it saves again (no waiting period)", async () => {
    await save();
    const first = copies();
    worker.now += 1_000;
    worker.routes.set("/groceries/shop", () => html(SHOP_HTML.replace("Eggs", "Eggs and milk")));
    await save();
    expect(copies()).not.toEqual(first);
    worker.online = false;
    expect(await (await dispatch("/groceries/shop"))!.text()).toContain("Eggs and milk");
  });

  test("asked while an older save runs, it saves again afterwards", async () => {
    const waits: Promise<unknown>[] = [];
    const ask = () => worker.handlers.get("message")!({ data: { type: "save-shop" }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    ask();
    // The list changes while the first save is still running.
    worker.routes.set("/groceries/shop", () => html(SHOP_HTML.replace("Eggs", "Eggs and bread")));
    worker.now += 1_000;
    ask();
    await Promise.all(waits);
    worker.online = false;
    expect(await (await dispatch("/groceries/shop"))!.text()).toContain("Eggs and bread");
    expect(copies()).toHaveLength(1);
  });
});

describe("with no signal", () => {
  test("the Shop view opens from the saved copy, with its own headers (so its nonce still matches)", async () => {
    await save();
    worker.online = false;
    const res = (await dispatch("/groceries/shop"))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("script-src 'nonce-abc'");
    expect(await res.text()).toContain("<p>Eggs</p>");
    expect(await (await dispatch("/_next/static/chunks/main.js", "no-cors"))!.text()).toBe("main()");
  });

  test("a page opened from the saved copy can ask, once, and a fresh one is told no", async () => {
    await save();
    await dispatch("/groceries/shop", "navigate", "fresh-tab");
    expect(await message({ type: "from-copy?" }, "fresh-tab")).toEqual({ fromCopy: false });
    worker.online = false;
    await dispatch("/groceries/shop", "navigate", "offline-tab");
    expect(await message({ type: "from-copy?" }, "offline-tab")).toEqual({ fromCopy: true });
    expect(await message({ type: "from-copy?" }, "offline-tab")).toEqual({ fromCopy: false });
  });

  test("another page offers the saved list, with no family data and no scripts", async () => {
    await save();
    worker.online = false;
    const res = (await dispatch("/chores"))!;
    expect(res.status).toBe(503);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain('<a href="/groceries/shop">Open the saved shopping list</a>');
    expect(body).not.toContain("Eggs");
    expect(body).not.toContain("<script");
  });

  test("with nothing saved, the page says to try again", async () => {
    worker.online = false;
    const body = await (await dispatch("/groceries/shop"))!.text();
    expect(body).toContain("Try again");
    expect(body).not.toContain("saved shopping list");
  });

  test("a copy older than 7 days is dropped, not shown", async () => {
    await save();
    worker.online = false;
    worker.now += 7 * DAY;
    expect(await (await dispatch("/groceries/shop"))!.text()).toContain("Try again");
    expect(copies()).toEqual([]);
  });

  test("a 6-day-old copy still opens", async () => {
    await save();
    worker.online = false;
    worker.now += 6 * DAY;
    expect(await (await dispatch("/groceries/shop"))!.text()).toContain("<p>Eggs</p>");
  });
});

test("other requests are left to the browser", async () => {
  expect(await dispatch("/api/auth/get-session", "cors")).toBeUndefined();
  let answered = false;
  worker.handlers.get("fetch")!({
    request: { url: ORIGIN + "/groceries/shop", method: "POST", mode: "navigate" },
    respondWith: () => (answered = true),
    waitUntil: () => {},
  });
  expect(answered).toBe(false);
});
