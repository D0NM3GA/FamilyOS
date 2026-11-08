import { prisma } from "@/lib/prisma";
import { householdWithAppOn } from "@/lib/app-switches";
import { COPY_ERRORS, readCalendarView, type ReadResult } from "@/lib/graph/app-calendar";

/**
 * Phase 70a: keeping the copy of the family's Outlook calendars fresh. The half-hourly background
 * job and a visit to Home or Calendar refresh any calendar over 15 minutes old, each under a lease so two
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
export const stillHere = { isHouseholdMember: true, entraAccessEndedAt: null } as const;

export const ALREADY_COPYING = "It's being copied right now. Try again in a minute.";

const freeAt = (now: Date) => ({ OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] });

/** Takes one calendar's lease if it's free. Returns the lease written (to release only that one), or null. */
async function takeLease(id: string, now: Date): Promise<Date | null> {
  const until = new Date(now.getTime() + LEASE_MS);
  const { count } = await prisma.outlookCalendar.updateMany({ where: { id, ...freeAt(now) }, data: { leaseUntil: until } });
  return count === 1 ? until : null;
}

export type Claim = { id: string; lease: Date };

/**
 * Claims every stale calendar (of one household, or of all), atomically per calendar. None while
 * the family has Calendar turned off. Returns the ids won.
 */
export async function claimStaleCalendars(householdId: string | null, now = new Date()): Promise<Claim[]> {
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const free = freeAt(now);
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
  const won: Claim[] = [];
  for (const { id } of candidates) {
    const lease = await takeLease(id, now);
    if (lease) won.push({ id, lease });
  }
  return won;
}

export type CopyResult = { ok: true; events: number } | { ok: false; error: string };

/**
 * Reads and stores one calendar, under its lease: the one a claim handed over, else one taken here
 * (an admin's Check access), so two copies of one calendar never run at once. Releases only its own
 * lease. Never throws for Outlook's answers: they become fixed-text `lastError`.
 */
export async function refreshOutlookCalendar(id: string, deps: { reader?: Reader; now?: Date; lease?: Date } = {}): Promise<CopyResult> {
  const now = deps.now ?? new Date();
  const reader = deps.reader ?? readCalendarView;
  const cal = await prisma.outlookCalendar.findUnique({ where: { id }, select: { mailbox: true, graphCalendarId: true } });
  if (!cal) return { ok: false, error: "Calendar not found." };
  const lease = deps.lease ?? (await takeLease(id, now));
  if (!lease) return { ok: false, error: ALREADY_COPYING };

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
      // Phase 70b: drivers follow their event (it may have moved); one whose event is gone stays
      // until it's past the window, so a read that briefly misses an event loses nobody's driver.
      const byId = new Map(events.map((e) => [e.graphId, e]));
      for (const d of await tx.eventDriver.findMany({ where: { outlookCalendarId: id }, select: { id: true, graphId: true, endsAt: true } })) {
        const e = byId.get(d.graphId);
        if (e && e.endsAt.getTime() !== d.endsAt.getTime()) await tx.eventDriver.update({ where: { id: d.id }, data: { endsAt: e.endsAt } });
        else if (!e && d.endsAt < range.start) await tx.eventDriver.delete({ where: { id: d.id } });
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
    await prisma.outlookCalendar.updateMany({ where: { id, leaseUntil: lease }, data: { leaseUntil: null } }).catch(() => {});
  }
}

/**
 * Someone whose access ended (the Entra check) or who left the household: their own calendar's
 * copy goes at once, and a family calendar in their mailbox switches off (an admin picks another).
 */
export async function dropEndedCalendars(now = new Date()): Promise<number> {
  const gone = { person: { NOT: stillHere } };
  const removed = await prisma.outlookCalendar.deleteMany({ where: { kind: "PERSON", ...gone } });
  // Phase 70b: nor are they anyone's driver any more.
  await prisma.eventDriver.deleteMany({ where: { person: { NOT: stillHere } } });
  const families = await prisma.outlookCalendar.findMany({ where: { kind: "FAMILY", active: true, ...gone }, select: { id: true } });
  for (const { id } of families) {
    await prisma.$transaction([
      prisma.outlookEvent.deleteMany({ where: { outlookCalendarId: id } }),
      prisma.eventDriver.deleteMany({ where: { outlookCalendarId: id } }),
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
  for (const { id, lease } of claimed) {
    const r = await refreshOutlookCalendar(id, { lease }).catch(() => ({ ok: false as const, error: COPY_ERRORS.failed }));
    if (r.ok) ok++;
    else failed++;
  }
  const parts = [`${ok} copied`];
  if (failed) parts.push(`${failed} failed`);
  if (dropped) parts.push(`${dropped} switched off`);
  return parts.join(", ");
}
