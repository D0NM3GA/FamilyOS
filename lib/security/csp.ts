import { randomBytes } from "node:crypto";

/**
 * Phase 42: the page's script policy (Content-Security-Policy), with a fresh nonce per request
 * (proxy.ts). Only scripts and `<style>` blocks carrying the nonce run, plus what they load
 * ('strict-dynamic': Next's own chunks); an injected script doesn't. Kept small and explained:
 * - 'wasm-unsafe-eval': the barcode decoder is WebAssembly (zxing-wasm, no workers or blobs).
 * - style-src-attr 'unsafe-inline': components use `style` attributes, which can't carry a
 *   nonce and can't run script; `<style>` blocks still need the nonce.
 * - images: this app, blob:/data: (photo previews, icons), Open Food Facts' image host.
 * - connect: this app, plus Sentry's ingest host only when a DSN is built in.
 * - development only: 'unsafe-eval' (React's dev tools) and the dev server's websocket.
 * - upgrade-insecure-requests only when the app is served over https.
 */
export const OPEN_FOOD_FACTS_IMAGES = "https://images.openfoodfacts.org";

export function makeNonce(): string {
  return randomBytes(16).toString("base64");
}

export function contentSecurityPolicy(o: { nonce: string; dev: boolean; https: boolean; sentryDsn?: string | null }): string {
  let sentry = "";
  try {
    if (o.sentryDsn) sentry = ` https://${new URL(o.sentryDsn).host}`;
  } catch {
    // A DSN that isn't a URL: Sentry can't send anyway.
  }
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${o.dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${o.nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${OPEN_FOOD_FACTS_IMAGES}`,
    `connect-src 'self'${sentry}${o.dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(o.https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** Files from public/ (static, no page of their own). */
const STATIC_PATHS = ["/zxing/", "/icons/", "/mascot/"];
const STATIC_FILES = new Set(["/sw.js", "/favicon.ico", "/robots.txt"]);

/**
 * Whether a response gets the policy: everything but API routes, Next's own files and public/'s,
 * and in-app navigation data (RSC and router prefetches, which carry no document). Documents a
 * browser prerenders are documents, so they get it too (Fable's review: skipping
 * `purpose: prefetch` would ship a prerendered page without its policy).
 */
export function isPageRequest(pathname: string, headers: Headers): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return false;
  if (STATIC_FILES.has(pathname) || STATIC_PATHS.some((p) => pathname.startsWith(p))) return false;
  if (headers.get("rsc") === "1" || headers.get("next-router-prefetch")) return false;
  return true;
}
