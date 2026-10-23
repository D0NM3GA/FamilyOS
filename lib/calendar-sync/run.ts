import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Graph, GraphResponse } from "@/lib/graph/client";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { getSchoolCalendarItems } from "@/lib/school/queries";
import { loadImportantDates, loadTaskInstances, loadVehicleDueDates } from "@/lib/calendar/sources";
import { buildDesiredEvents, syncOptionsWithApps, type SyncOptions, type SyncSources } from "./events";
import { cleanDisabledApps, isAppOn } from "@/lib/apps";
import { planSync, type SyncOp } from "./plan";

/**
 * Runs one calendar sync (Phase 17): gather what the calendar should hold, diff it against
 * what the app last wrote, and apply the difference through Graph, one call at a time
 * (Outlook allows 4 concurrent requests per mailbox; a family calendar never needs more
 * than one). Graph is injected, so the whole run is testable without Microsoft.
 */

export type { Graph };

export const MAX_OPS_PER_RUN = 60;
const LEASE_MS = 5 * 60_000;
/** How far ahead chores and meds are written. */
const TASK_HORIZON_DAYS = 14;
/** Tags every event with the row it mirrors, so an orphan can be traced even without its link. */
const SOURCE_PROPERTY_ID = "String {5b6a2d4e-8f0c-4c8e-9f3b-2a7d1e6c9b10} Name FamilyOSSourceKey";

export type RunResult =
  | { status: "skipped"; reason: "busy" | "missing" | "off" }
  | { status: "done"; created: number; updated: number; deleted: number; remaining: number; error: string | null };

/** Fixed text only: shown on the page, and may reach logs. Never event titles. */
const ERRORS = {
  auth: "Microsoft said no to writing the calendar. Grant calendar access on this page, then sync again.",
  expired: "Your Microsoft sign-in expired partway through. The rest will sync next time.",
  calendarGone: "The calendar was deleted in Outlook. Disconnect, then connect again to make a new one.",
  throttled: "Outlook asked the app to slow down. The rest will sync on the next run.",
  failed: "Some events couldn't be written. The next sync will try again.",
};

/**
 * Takes the run's lease: at most one sync per household at a time, across tabs and
 * renders. Returns false when another run holds it.
 */
export async function claimLease(syncId: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.calendarSync.updateMany({
    where: { id: syncId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return count === 1;
}

/**
 * Keeps the lease alive while a run is still working: renewed before every Graph call, so a
 * slow, throttled run (up to 60 calls of up to 20 s each) never lets a second run start
 * over the same links and make duplicate events.
 */
async function renewLease(syncId: string): Promise<void> {
  await prisma.calendarSync.updateMany({
    where: { id: syncId, leaseUntil: { not: null } },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
}

/** Phase 36: whether this sync's family has Calendar on. A missing sync counts as on (runSync reports it missing). */
export async function calendarSyncOn(syncId: string): Promise<boolean> {
  const row = await prisma.calendarSync.findUnique({ where: { id: syncId }, select: { household: { select: { disabledApps: true } } } });
  return !row || isAppOn(cleanDisabledApps(row.household.disabledApps), "calendar");
}

/** Whether Home should start an automatic sync: stale or options changed, not backing off, not running. */
export function autoSyncDue(
  sync: { lastSyncedAt: Date | null; retryAfterUntil: Date | null; leaseUntil: Date | null; optionsChangedAt?: Date | null },
  now = new Date(),
  everyMs = 30 * 60_000,
): boolean {
  if (sync.leaseUntil && sync.leaseUntil > now) return false;
  if (sync.retryAfterUntil && sync.retryAfterUntil > now) return false;
  if (!sync.lastSyncedAt) return true;
  if (sync.optionsChangedAt && sync.optionsChangedAt > sync.lastSyncedAt) return true;
  return now.getTime() - sync.lastSyncedAt.getTime() >= everyMs;
}

/**
 * Finds an app-made event by the source tag it was created with. Used when the app lost
 * track of an event's id: a create whose reply never arrived.
 */
async function findBySourceKey(graph: Graph, calendarId: string, sourceKey: string): Promise<string | null> {
  const quote = (s: string) => s.replace(/'/g, "''");
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${SOURCE_PROPERTY_ID}' and ep/value eq '${quote(sourceKey)}')`;
  const res = await graph("GET", `/me/calendars/${encodeURIComponent(calendarId)}/events?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`);
  const id = (res.json as { value?: { id?: unknown }[] } | null)?.value?.[0]?.id;
  return res.status < 400 && typeof id === "string" ? id : null;
}

/**
 * What the Outlook calendar should hold, read through lib/calendar/sources (shared with the
 * in-app agenda): every household row, still-to-do chores and doses from active
 * definitions for the next two weeks, and open school items from today on.
 */
export async function gatherSources(householdId: string, options: SyncOptions, now: Date): Promise<SyncSources> {
  const today = atMidnight(now);
  const horizon = addDays(today, TASK_HORIZON_DAYS);
  const domains = [...(options.includeChores ? (["CHORE"] as const) : []), ...(options.includeMeds ? (["MED"] as const) : [])];
  // Home only generates instances up to today; the calendar shows two weeks.
  for (const domain of domains) await ensureInstancesGenerated(householdId, horizon, domain);

  const [dates, vehicles, tasks, school] = await Promise.all([
    options.includeDates ? loadImportantDates(householdId) : [],
    options.includeVehicles ? loadVehicleDueDates(householdId) : [],
    loadTaskInstances(householdId, { domains, from: today, until: horizon, pendingOnly: true, activeOnly: true }),
    options.includeSchoolTasks || options.includeAssignments ? getSchoolCalendarItems(householdId, today) : { tasks: [], assignments: [] },
  ]);

  return {
    dates: dates.map((d) => ({ id: d.id, type: d.type, label: d.label, month: d.month, day: d.day, year: d.year, personName: d.personName })),
    vehicles: vehicles.map((v) => ({ itemId: v.itemId, title: v.title, vehicleName: v.vehicleName, dueByDate: v.dueByDate })),
    tasks: tasks.map((t) => ({ id: t.id, domain: t.domain, title: t.title, dueDate: t.dueDate, timed: t.timed, assigneeName: t.assigneeName })),
    school: [
      ...school.tasks.map((t) => ({ ...t, kind: "task" as const })),
      ...school.assignments.map((a) => ({ ...a, kind: "assignment" as const })),
    ],
  };
}

type Stop = { error: string; retryAfterSeconds?: number };

/** Applies one op. Returns a Stop to end the run, or the counter it bumped. */
async function apply(op: SyncOp, ctx: { syncId: string; calendarId: string; graph: Graph }): Promise<Stop | "created" | "updated" | "deleted" | "failed"> {
  const { syncId, calendarId, graph } = ctx;
  const stopFor = (res: GraphResponse): Stop | null => {
    // 401: the token ran out mid-run (it was fetched before the run started). 403: consent.
    if (res.status === 401) return { error: ERRORS.expired };
    if (res.status === 403) return { error: ERRORS.auth };
    if (res.status === 429 || res.status === 503) return { error: ERRORS.throttled, retryAfterSeconds: res.retryAfter ?? 60 };
    return null;
  };

  if (op.kind === "delete") {
    // A create whose reply was lost may still have made the event: look it up by its tag,
    // or it would stay on the family calendar for good.
    const eventId = op.graphEventId ?? (await findBySourceKey(graph, calendarId, op.sourceKey));
    if (eventId) {
      const res = await graph("DELETE", `/me/events/${encodeURIComponent(eventId)}`);
      const stop = stopFor(res);
      if (stop) return stop;
      if (res.status >= 400 && res.status !== 404) return "failed"; // 404: someone already deleted it
    }
    await prisma.calendarEventLink.delete({ where: { syncId_sourceKey: { syncId, sourceKey: op.sourceKey } } });
    return "deleted";
  }

  if (op.kind === "update") {
    const res = await graph("PATCH", `/me/events/${encodeURIComponent(op.graphEventId)}`, op.event.payload);
    const stop = stopFor(res);
    if (stop) return stop;
    if (res.status === 404) {
      // Deleted by hand in Outlook: recreate it, as a fresh create.
      return apply({ kind: "create", event: op.event, transactionId: null }, ctx);
    }
    if (res.status >= 400) return "failed";
    await prisma.calendarEventLink.update({
      where: { syncId_sourceKey: { syncId, sourceKey: op.event.sourceKey } },
      data: { contentHash: op.event.hash },
    });
    return "updated";
  }

  // Create: save the link (and its transactionId) first, so a crash before Graph answers
  // retries this same create next run instead of making a second event.
  const transactionId = op.transactionId ?? randomUUID();
  await prisma.calendarEventLink.upsert({
    where: { syncId_sourceKey: { syncId, sourceKey: op.event.sourceKey } },
    create: { syncId, sourceKey: op.event.sourceKey, graphEventId: null, contentHash: op.event.hash, transactionId },
    update: { graphEventId: null, contentHash: op.event.hash, transactionId },
  });
  const res = await graph("POST", `/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    ...op.event.payload,
    transactionId,
    singleValueExtendedProperties: [{ id: SOURCE_PROPERTY_ID, value: op.event.sourceKey }],
  });
  const stop = stopFor(res);
  if (stop) return stop;
  if (res.status === 404) return { error: ERRORS.calendarGone };
  let id = (res.json as { id?: unknown } | null)?.id;
  if ((res.status >= 400 || typeof id !== "string") && op.transactionId) {
    // A retried create Graph won't repeat: it may already exist from the first attempt.
    id = await findBySourceKey(graph, calendarId, op.event.sourceKey);
  }
  if (typeof id !== "string") {
    // Start the next attempt fresh rather than repeating one Graph keeps refusing.
    await prisma.calendarEventLink.update({
      where: { syncId_sourceKey: { syncId, sourceKey: op.event.sourceKey } },
      data: { transactionId: randomUUID() },
    });
    return "failed";
  }
  await prisma.calendarEventLink.update({
    where: { syncId_sourceKey: { syncId, sourceKey: op.event.sourceKey } },
    data: { graphEventId: id },
  });
  return "created";
}

/**
 * One sync run. Takes the lease itself unless the caller already did (Home claims it
 * before scheduling the run with after(), so two renders can't both schedule one).
 */
export async function runSync(opts: { syncId: string; graph: Graph; now?: Date; leaseHeld?: boolean }): Promise<RunResult> {
  const now = opts.now ?? new Date();
  // Phase 36: Calendar turned off pauses the sync; what's in Outlook stays as it was. Checked
  // before anything is written, so a paused sync doesn't look like one that ran.
  if (!(await calendarSyncOn(opts.syncId))) {
    if (opts.leaseHeld) await prisma.calendarSync.updateMany({ where: { id: opts.syncId }, data: { leaseUntil: null } });
    return { status: "skipped", reason: "off" };
  }
  if (!opts.leaseHeld && !(await claimLease(opts.syncId, now))) return { status: "skipped", reason: "busy" };

  const counts = { created: 0, updated: 0, deleted: 0, failed: 0 };
  let error: string | null = null;
  let retryAfterUntil: Date | null = null;
  let remaining = 0;
  try {
    const sync = await prisma.calendarSync.findUnique({
      where: { id: opts.syncId },
      include: { household: { select: { timezone: true, disabledApps: true } }, links: true },
    });
    if (!sync) return { status: "skipped", reason: "missing" };
    // Phase 36: a turned-off app's events come off the calendar until it's back on.
    const options = syncOptionsWithApps(sync, cleanDisabledApps(sync.household.disabledApps));

    const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sources = await gatherSources(sync.householdId, options, now);
    // One zone for everything: task times are "HH:mm" the family typed, which mean that
    // wall-clock time where the family lives.
    const zone = sync.household.timezone ?? serverZone;
    const desired = buildDesiredEvents(sources, options, { allDay: zone, timed: zone });
    const plan = planSync(desired, sync.links, MAX_OPS_PER_RUN);
    remaining = plan.remaining;

    for (let i = 0; i < plan.ops.length; i++) {
      await renewLease(sync.id);
      const outcome = await apply(plan.ops[i], { syncId: sync.id, calendarId: sync.calendarId, graph: opts.graph });
      if (typeof outcome === "object") {
        error = outcome.error;
        if (outcome.retryAfterSeconds) retryAfterUntil = new Date(now.getTime() + outcome.retryAfterSeconds * 1000);
        remaining += plan.ops.length - i;
        break;
      }
      counts[outcome]++;
    }
    if (!error && counts.failed > 0) error = ERRORS.failed;
    return { status: "done", created: counts.created, updated: counts.updated, deleted: counts.deleted, remaining, error };
  } finally {
    await prisma.calendarSync
      .updateMany({
        where: { id: opts.syncId },
        data: {
          leaseUntil: null,
          lastSyncedAt: now,
          lastError: error,
          lastResult: `${counts.created} added, ${counts.updated} updated, ${counts.deleted} removed${remaining ? `, ${remaining} still to do` : ""}`,
          retryAfterUntil,
        },
      })
      .catch(() => {});
  }
}
