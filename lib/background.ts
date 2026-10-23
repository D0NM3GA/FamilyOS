import { captureError } from "@/lib/observability";

/**
 * Phase 27: background jobs, for a long-running server (the home Proxmox container). Started
 * once per server process from instrumentation.ts. A deliberate aggregator (it runs other
 * domains' jobs), so no domain may import it back (eslint.config.mjs).
 *
 * On in production, off in development and tests unless BACKGROUND_JOBS=1; BACKGROUND_JOBS=0
 * turns it off anywhere. Never during `next build` (its workers load instrumentation too).
 * A tick never throws, and a slow tick isn't overlapped by the next. Several app instances
 * are safe: every job claims its work in the database (sync leases, one alert per key).
 */

const FIRST_TICK_MS = 60_000;
const TICK_MS = 30 * 60_000;

export function backgroundJobsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.BACKGROUND_JOBS === "0") return false;
  if (env.BACKGROUND_JOBS === "1") return true;
  return env.NODE_ENV === "production";
}

const state = globalThis as typeof globalThis & { __familyosJobs?: boolean };

export function startBackgroundJobs(): void {
  if (state.__familyosJobs || !backgroundJobsEnabled()) return;
  state.__familyosJobs = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Phase 49: first, so every job runs on the household's clock.
      const { syncServerZone } = await import("@/lib/household-zone");
      await syncServerZone();
      const { runMoneyJobs } = await import("@/lib/finance/jobs");
      await runMoneyJobs();
      // Phase 40.1c: expired sign-in challenges and setup tokens.
      const { purgeExpiredVerifications } = await import("@/lib/setup");
      await purgeExpiredVerifications();
      // Phase 40.2b: invites past their 48 hours.
      const { purgeExpiredInvites, purgeOrphanProviderSignIns } = await import("@/lib/invites");
      await purgeExpiredInvites();
      // Phase 40.3: provider sign-ins that never became anyone.
      await purgeOrphanProviderSignIns();
      // Phase 40.4: who Entra assigns to the app (keeps its own errors).
      const { runScheduledEntraCheck } = await import("@/lib/entra-check");
      await runScheduledEntraCheck();
    } catch (err) {
      captureError(new Error(`background jobs tick failed: ${err instanceof Error ? err.constructor.name : "unknown"}`));
    } finally {
      running = false;
    }
  };
  // unref: the timers never keep a process alive on their own.
  setTimeout(tick, FIRST_TICK_MS).unref();
  setInterval(tick, TICK_MS).unref();
}
