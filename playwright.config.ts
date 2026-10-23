import { defineConfig, devices } from "@playwright/test";

// Phase 41: browser smoke tests (README "Testing"). `npm run test:e2e` starts its own production
// server on a fresh database (e2e/serve.mjs); E2E_BASE_URL points them at one that's already
// running instead (a container, later), which must be on a fresh install of its own.
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

export default defineConfig({
  testDir: "e2e",
  // One household, one story (e2e/smoke.spec.ts): setup, then an invite, then the rest. Never in
  // parallel, never retried (a retry would meet an install that's already set up).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Chromium only: passkeys come from its virtual authenticator (e2e/support.ts). The new
  // headless mode (channel "chromium"), the same browser people use, not the headless shell.
  // E2E_CHANNEL=msedge uses the installed Edge instead, for a Windows machine where Playwright's
  // own Chromium won't start (README "Testing").
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL || "chromium" } }],
  webServer: external
    ? undefined
    : {
        command: "node e2e/serve.mjs",
        // Better Auth's own health check: up once the server answers, without touching a page
        // (a page would ask the database whether the app is set up).
        url: `${baseURL}/api/auth/ok`,
        reuseExistingServer: false,
        // A production build on a cold cache.
        timeout: 10 * 60_000,
        stdout: "pipe",
        stderr: "pipe",
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      },
});
