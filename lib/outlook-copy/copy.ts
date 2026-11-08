import { prisma } from "@/lib/prisma";
import { householdWithAppOn } from "@/lib/app-switches";
import { COPY_ERRORS, readCalendarView, type ReadResult } from "@/lib/graph/app-calendar";

/**
 * Phase 70a: keeping the copy of the family's Outlook calendars fresh. The background job and a
 * visit to Home or Calendar refresh any calendar over 15 minutes old, each under a lease so two
 * can't copy one calendar at once. The copy covers a week back to two months ahead and is
 * replaced on every success; a failed read keeps the last copy.
 */

export const STALE_MS = 15 * 60_000;
const LEASE_MS = 3 * 60_000;
export const PAST_DAYS = 7;
export const FUTURE_DAYS = 60;
const CHUNK = 500;
/** Without a Retry-After, a busy Outlook is left alone this long. */
const BUSY_WAIT_MS = 5 * 60_000;

export const ACCESS_ENDED = "Off: the person whose mailbox this is no longer has access.";

type Reader = (mailbox: string, graphCalendarId: string | null, range: { start: Date; end: Date }) => Promise<ReadResult>;

/** Who may still have a calendar copied: in the household, and not cut off by the Entra check. */
const stillHere = { isHouseholdMember: true, entraAccessEndedAt: null } as const;

/**
 * Claims every stale calendar (of one household, or of all), atomically per calendar. None while
 * the family has Calendar turned off. Returns the ids won.
 */
export async function claimStaleCalendars(householdId: string | null, now = new Date()): Promise<string[]> {
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const free = { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] };
  const candidates = await prisma.outlookCalendar.findMany({
    where: {
      ...(householdId ? { householdId } : {}),
      household: householdWithAppOn("calendar"),
      active: true,
      person: stillHere,
      AND: [
        { OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: staleBefore } }] },
        { OR: [{ retryAfterUntil: null }, { retryAfterUntil: { lt: now } }] },
        free,
      ],
    },
    select: { id: true },
  });
  const won: string[] = [];
  for (const { id } of candidates) {
    const { count } = await prisma.outlookCalendar.updateMany({ where: { id, ...free }, data: { leaseUntil: new Date(now.getTime() + LEASE_MS) } });
    if (count === 1) won.push(id);
  }
  return won;
}

export type CopyResult = { ok: true; events: number } | { ok: false; error: string };

/**
 * Reads and stores one calendar. Expects the caller to hold the lease (or to be an admin's Check
 * access), and always releases it. Never throws for Outlook's answers: they become fixed-text
 * `lastError`.
 */
export async function refreshOutlookCalendar(id: string, deps: { reader?: Reader; now?: Date } = {}): Promise<CopyResult> {
  const now = deps.now ?? new Date();
  const reader = deps.reader ?? readCalendarView;
  const cal = await prisma.outlookCalendar.findUnique({ where: { id }, select: { mailbox: true, graphCalendarId: true } });
  if (!cal) return { ok: false, error: "Calendar not found." };

  try {
    const range = { start: new Date(now.getTime() - PAST_DAYS * 86_400_000), end: new Date(now.getTime() + FUTURE_DAYS * 86_400_000) };
    const read = await reader(cal.mailbox, cal.graphCalendarId, range);
    if (!read.ok) {
      const wait = read.error === COPY_ERRORS.busy ? (read.retryAfterSeconds ? read.retryAfterSeconds * 1000 : BUSY_WAIT_MS) : 0;
      await prisma.outlookCalendar.update({
        where: { id },
        data: { lastFetchedAt: now, lastError: read.error, retryAfterUntil: wait ? new Date(now.getTime() + wait) : null },
      });
      return { ok: false, error: read.error };
    }
    // One event can come back twice across pages when it's edited mid-read: keep the first.
    const seen = new Set<string>();
    const events = read.events.filter((e) => !seen.has(e.graphId) && Boolean(seen.add(e.graphId)));
    await prisma.$transaction(async (tx) => {
      await tx.outlookEvent.deleteMany({ where: { outlookCalendarId: id } });
      for (let i = 0; i < events.length; i += CHUNK) {
        await tx.outlookEvent.createMany({ data: events.slice(i, i + CHUNK).map((e) => ({ outlookCalendarId: id, ...e })) });
      }
    });
    await prisma.outlookCalendar.update({
      where: { id },
      data: { lastFetchedAt: now, lastSuccessAt: now, lastError: read.truncated ? COPY_ERRORS.truncated : null, retryAfterUntil: null },
    });
    return { ok: true, events: events.length };
  } catch (err) {
    // A database error mid-replace still counts as this attempt, so the 15-minute wait applies.
    await prisma.outlookCalendar.update({ where: { id }, data: { lastFetchedAt: now, lastError: COPY_ERRORS.failed } }).catch(() => {});
    throw err;
  } finally {
    await prisma.outlookCalendar.updateMany({ where: { id, leaseUntil: { not: null } }, data: { leaseUntil: null } }).catch(() => {});
  }
}

/**
 * Someone whose access ended (the Entra check) or who left the household: their own calendar's
 * copy goes at once, and a family calendar in their mailbox switches off (an admin picks another).
 */
export async function dropEndedCalendars(now = new Date()): Promise<number> {
  const gone = { person: { NOT: stillHere } };
  const removed = await prisma.outlookCalendar.deleteMany({ where: { kind: "PERSON", ...gone } });
  const families = await prisma.outlookCalendar.findMany({ where: { kind: "FAMILY", active: true, ...gone }, select: { id: true } });
  for (const { id } of families) {
    await prisma.$transaction([
      prisma.outlookEvent.deleteMany({ where: { outlookCalendarId: id } }),
      prisma.outlookCalendar.update({ where: { id }, data: { active: false, lastError: ACCESS_ENDED, lastFetchedAt: now } }),
    ]);
  }
  return removed.count + families.length;
}

/** The background job: drop what's no longer allowed, then refresh every stale calendar. */
export async function runOutlookCopy(now = new Date()): Promise<string> {
  const dropped = await dropEndedCalendars(now);
  const claimed = await claimStaleCalendars(null, now);
  let ok = 0;
  let failed = 0;
  for (const id of claimed) {
    const r = await refreshOutlookCalendar(id).catch(() => ({ ok: false as const, error: COPY_ERRORS.failed }));
    if (r.ok) ok++;
    else failed++;
  }
  const parts = [`${ok} copied`];
  if (failed) parts.push(`${failed} failed`);
  if (dropped) parts.push(`${dropped} switched off`);
  return parts.join(", ");
}
