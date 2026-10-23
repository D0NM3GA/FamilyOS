import { describe, expect, test } from "vitest";
import { contentSecurityPolicy, isPageRequest, makeNonce } from "./csp";

/** Phase 42: the script policy pages get (proxy.ts). */
describe("the script policy", () => {
  test("a fresh, unguessable nonce each time", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(makeNonce()).not.toBe(a);
  });

  test("production: nonce scripts only, no eval, nothing loose", () => {
    const p = contentSecurityPolicy({ nonce: "abc", dev: false, https: true });
    expect(p).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(p).not.toContain("'unsafe-eval'");
    expect(p).toContain("style-src 'self' 'nonce-abc'");
    expect(p).not.toMatch(/style-src [^;]*'unsafe-inline'/);
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("base-uri 'self'");
    expect(p).toContain("connect-src 'self';");
    expect(p).toContain("upgrade-insecure-requests");
  });

  test("development, plain http, and Sentry", () => {
    const p = contentSecurityPolicy({ nonce: "abc", dev: true, https: false, sentryDsn: "https://key@o123.ingest.sentry.io/456" });
    expect(p).toContain("'unsafe-eval'");
    expect(p).toContain("connect-src 'self' https://o123.ingest.sentry.io ws: wss:");
    expect(p).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ nonce: "x", dev: false, https: false, sentryDsn: "not a url" })).toContain("connect-src 'self';");
  });

  test("only pages get it", () => {
    const h = new Headers();
    expect(isPageRequest("/settings", h)).toBe(true);
    expect(isPageRequest("/", h)).toBe(true);
    expect(isPageRequest("/api/auth/ok", h)).toBe(false);
    expect(isPageRequest("/_next/static/chunks/a.js", h)).toBe(false);
    expect(isPageRequest("/sw.js", h)).toBe(false);
    expect(isPageRequest("/zxing/zxing_reader-3.1.3.wasm", h)).toBe(false);
    expect(isPageRequest("/icons/bunny.png", h)).toBe(false);
    expect(isPageRequest("/settings", new Headers({ "next-router-prefetch": "1" }))).toBe(false);
    expect(isPageRequest("/settings", new Headers({ rsc: "1" }))).toBe(false);
    // A page the browser prerenders is still a page; so is one with a dot in its path.
    expect(isPageRequest("/settings", new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPageRequest("/people/jo.smith", h)).toBe(true);
  });
});
