import { captureError, describeError, log } from "@/lib/observability";
import type { JobName } from "@/lib/heartbeat";

/**
 * Phase 27: background jobs, for a long-running server (the home Proxmox container). Started
 * once per server process from instrumentation.ts. A deliberate aggregator (it runs other
 * domains' jobs), so no domain may import it back (eslint.config.mjs).
 *
 * On in production, off in development and tests unless BACKGROUND_JOBS=1; BACKGROUND_JOBS=0
 * turns it off anywhere. Never during `next build` (its workers load instrumentation too).
 * A tick never throws, and a slow tick isn't overlapped by the next. Several app instances
 * are safe: every job claims its work in the database (sync leases, one alert per key).
 *
 * Phase 61: each job runs on its own, so one failing (the bank feed down) never keeps the next
 * (the Entra access check, which ends access) from running; each records a heartbeat for the
 * System card on Data, and HEALTHCHECK_PING_URL hears about the whole tick.
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

type Job = { name: JobName; run: () => Promise<string | null | void> };

/** The jobs, in order: the zone first, so every other job runs on the household's clock. */
function jobs(): Job[] {
  return [
    { name: "zone", run: async () => (await import("@/lib/household-zone")).syncServerZone() },
    { name: "money", run: async () => (await import("@/lib/finance/jobs")).runMoneyJobs() },
    {
      name: "purges",
      run: async () => {
        // Phase 40: expired sign-in challenges and setup tokens, invites past their 48 hours, and
        // provider sign-ins that never became anyone.
        const { purgeExpiredVerifications } = await import("@/lib/setup");
        const { purgeExpiredInvites, purgeOrphanProviderSignIns } = await import("@/lib/invites");
        await purgeExpiredVerifications();
        await purgeExpiredInvites();
        await purgeOrphanProviderSignIns();
      },
    },
    { name: "entra", run: async () => (await import("@/lib/entra-check")).runScheduledEntraCheck() },
    // Phase 62: doses, meds running low, school due, birthdays (lib/reminders).
    { name: "reminders", run: async () => (await import("@/lib/reminders/run")).runReminders() },
    {
      name: "cleanup",
      run: async () => {
        const { sessions, notifications } = await (await import("@/lib/retention")).runCleanup();
        return `${sessions} old sessions, ${notifications} old notifications`;
      },
    },
  ];
}

/** Phase 67b: how long one job may take before the tick gives up on it and moves on. */
export const JOB_TIMEOUT_MS = 10 * 60_000;

export class JobTimedOut extends Error {
  constructor() {
    super("timed out");
    this.name = "JobTimedOut";
  }
}

/**
 * The job's answer, or JobTimedOut past `ms`. A promise can't be cancelled, so a timed-out run
 * carries on by itself: its late answer is dropped (nothing records it), and the jobs that could
 * clash with a second run hold leases (money, the Entra check) or claim per key (reminders); the
 * rest are idempotent.
 */
export async function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  // A late failure from an abandoned run mustn't become an unhandled rejection.
  run.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JobTimedOut()), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([run, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One tick: every job in turn, each in its own try/catch, its heartbeat recorded either way, and
 * (Phase 67b) each within JOB_TIMEOUT_MS, so one hung call can't hold up the jobs after it.
 * Returns whether every job succeeded. Exported for tests (`list`, `record` and `timeoutMs` stand in).
 */
export async function runTick(
  list: Job[] = jobs(),
  record: { ok: (name: string, detail: string | null) => Promise<void>; failed: (name: string, err: unknown) => Promise<void> } = defaultRecord,
  timeoutMs: number = JOB_TIMEOUT_MS,
): Promise<boolean> {
  let allOk = true;
  for (const job of list) {
    try {
      const detail = await withTimeout(Promise.resolve().then(() => job.run()), timeoutMs);
      await record.ok(job.name, detail || null).catch((err) => log.warn("jobs.heartbeat_failed", { job: job.name, error: describeError(err) }));
    } catch (err) {
      allOk = false;
      captureError(err, "jobs.failed", { job: job.name });
      await record.failed(job.name, err).catch(() => {});
    }
  }
  return allOk;
}

const defaultRecord = {
  ok: async (name: string, detail: string | null) => (await import("@/lib/heartbeat")).recordOk(name, detail),
  failed: async (name: string, err: unknown) => (await import("@/lib/heartbeat")).recordFailure(name, err),
};

/**
 * The outside check-in (healthchecks.io's convention): the URL after a good tick, `/fail` after
 * one where a job failed. Set by the owner; http or https only. Pure.
 */
export function pingUrl(raw: string | undefined, ok: boolean): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!ok) url.pathname = `${url.pathname.replace(/\/$/, "")}/fail`;
    return url.toString();
  } catch {
    return null;
  }
}

/** Never throws: a failed ping is only a log line. */
export async function ping(raw: string | undefined, ok: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const url = pingUrl(raw, ok);
  if (!url) return;
  try {
    const res = await fetcher(url, { method: "GET", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) log.warn("jobs.ping_refused", { status: res.status });
  } catch (err) {
    log.warn("jobs.ping_failed", { error: describeError(err) });
  }
}

export function startBackgroundJobs(): void {
  if (state.__familyosJobs || !backgroundJobsEnabled()) return;
  state.__familyosJobs = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ok = await runTick();
      await ping(process.env.HEALTHCHECK_PING_URL, ok);
    } catch (err) {
      // runTick handles each job's own errors; this is for anything around them.
      captureError(err);
    } finally {
      running = false;
    }
  };
  // unref: the timers never keep a process alive on their own.
  setTimeout(tick, FIRST_TICK_MS).unref();
  setInterval(tick, TICK_MS).unref();
}
