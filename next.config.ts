import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Extra hostnames allowed to reach dev-only assets and HMR, for testing on phones (Phase
// 10.5): scripts/dev-lan.mjs sets it from .env.lan. Empty otherwise; dev only.
const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  // No "X-Powered-By: Next.js" advertising the framework.
  poweredByHeader: false,
  // Phase 43: the production image runs `.next/standalone` (only the files the server traces),
  // not a whole `node_modules`. argon2 finds its native binary with a directory search at run
  // time, which tracing can't follow, so its Linux prebuilds are named here.
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["node_modules/argon2/prebuilds/linux-*/**"] },
  experimental: {
    // Phase 24: server actions accept 1 MB by default and this limit is global. The only
    // large one is the receipt photo (readReceipt), which the phone already shrinks to well
    // under 1 MB. The limit counts the raw multipart body, so it sits above the action's own
    // 3 MB cap: an oversized photo then gets the friendly "too big" message, not an error page.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // The barcode decoder's wasm (scripts/copy-zxing-wasm.mjs) has its version in the
  // filename, so it can be cached forever.
  // Phase 39: the icons moved off /icon/32, /icon/192 and /icon/512 (an icon file with several
  // sizes). Installed phones, their cached manifest and the old service worker's notifications
  // may ask the old addresses for a day or so.
  async redirects() {
    return [
      { source: "/icon/:size(192|512)", destination: "/app-icon/:size", permanent: true },
      { source: "/icon/32", destination: "/icon", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Security headers on every response. The CSP only covers framing, <base> and
        // plugins: a full script/style policy needs nonces for Next's inline scripts and the
        // theme script, which is its own piece of work.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Pages carry ids (jars, people) in their paths; images from Open Food Facts and
          // links out shouldn't get them.
          { key: "Referrer-Policy", value: "same-origin" },
          // Camera for barcode scanning (Phase 10.5); nothing else.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
          // HTTPS only once hosted. No includeSubDomains: other names on the same domain
          // aren't this app's to pin.
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
        ],
      },
      {
        source: "/zxing/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Bunson's sprites change rarely, but their names carry no version: a day, then
        // served stale while the browser checks for a new one.
        source: "/mascot/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        // Phase 21.6: the push service worker must never be served stale, or a fix to it
        // wouldn't reach phones.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
  turbopack: {
    // An explicit project root (it also sets outputFileTracingRoot). Next 16.3 already stops
    // root inference at a git worktree's boundary, so a checkout under .claude/worktrees/ no
    // longer picks up the parent's lockfile; this pins the same answer for any checkout that
    // isn't under a git boundary at all (e.g. a copied deploy directory). See docs/BUILD.md
    // Phase 14.
    root: import.meta.dirname,
  },
};

export default withSentryConfig(nextConfig, {
  // Only used to upload source maps (off below); each install sets its own Sentry slugs.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // No build telemetry sent to Sentry about this project's build.
  telemetry: false,
  // Source-map upload waits for hosting (it needs SENTRY_AUTH_TOKEN). It must be disabled
  // explicitly: under Turbopack, withSentryConfig otherwise turns on
  // productionBrowserSourceMaps, which would PUBLISH the app's source maps with no upload.
  sourcemaps: { disable: true },
});
