import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CopiedEvent, ReadResult } from "@/lib/graph/app-calendar";

/**
 * Phase 70a against a real database (`npm run test:db`): the copy replaces a calendar's events and
 * keeps the last copy when Outlook fails; leases and Calendar off stop a claim; someone whose access
 * ended loses their copy; a kid sees the family calendar and their own, never a grown-up's.
 */
const RUN = import.meta.env.MODE === "db";
vi.mock("next/server", () => ({ after: () => {} }));

describe.skipIf(!RUN)("the Outlook copy (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", max: "", family: "", dadCal: "", ivyCal: "" };
  const now = new Date();
  const soon = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const ev = (graphId: string, extra: Partial<CopiedEvent> = {}): CopiedEvent => ({
    graphId,
    iCalUId: null,
    title: graphId,
    location: null,
    startsAt: soon(2),
    endsAt: soon(3),
    allDay: false,
    isPrivate: false,
    ...extra,
  });
  const reader = (result: ReadResult) => async () => result;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-outlook-copy-${t}` } });
    const mk = (firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, mom, ivy, max] = await Promise.all([mk("Dad", "ADMIN"), mk("Mom", "ADULT"), mk("Ivy", "KID"), mk("Max", "KID")]);
    const cal = (kind: "PERSON" | "FAMILY", personId: string) =>
      prisma.outlookCalendar.create({ data: { householdId: h.id, kind, personId, mailbox: `${personId}@example.com` }, select: { id: true } });
    const [family, dadCal, ivyCal] = await Promise.all([cal("FAMILY", mom.id), cal("PERSON", dad.id), cal("PERSON", ivy.id)]);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, max: max.id, family: family.id, dadCal: dadCal.id, ivyCal: ivyCal.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("a refresh replaces the events; a failure keeps the last copy and notes the wait", async () => {
    const { refreshOutlookCalendar } = await import("./copy");
    expect(await refreshOutlookCalendar(ids.family, { reader: reader({ ok: true, events: [ev("dinner", { title: "Dinner at Grandma's" }), ev("dinner")], truncated: false }) })).toEqual({ ok: true, events: 1 });
    expect(await refreshOutlookCalendar(ids.family, { reader: reader({ ok: true, events: [ev("picnic"), ev("recital")], truncated: false }) })).toEqual({ ok: true, events: 2 });
    const kept = await prisma.outlookEvent.findMany({ where: { outlookCalendarId: ids.family }, orderBy: { graphId: "asc" } });
    expect(kept.map((e) => e.graphId)).toEqual(["picnic", "recital"]);

    const { COPY_ERRORS } = await import("@/lib/graph/app-calendar");
    const r = await refreshOutlookCalendar(ids.family, { reader: reader({ ok: false, error: COPY_ERRORS.busy, retryAfterSeconds: 120 }), now });
    expect(r.ok).toBe(false);
    expect(await prisma.outlookEvent.count({ where: { outlookCalendarId: ids.family } })).toBe(2);
    const row = await prisma.outlookCalendar.findUniqueOrThrow({ where: { id: ids.family } });
    expect(row.lastError).toBe(COPY_ERRORS.busy);
    expect(row.retryAfterUntil?.getTime()).toBe(now.getTime() + 120_000);
    expect(row.leaseUntil).toBeNull();
  });

  test("claims skip a leased, a fresh, a waiting calendar, and a family with Calendar off", async () => {
    const { claimStaleCalendars } = await import("./copy");
    await prisma.outlookCalendar.updateMany({ where: { householdId: ids.h }, data: { lastFetchedAt: null, retryAfterUntil: null, leaseUntil: null } });
    await prisma.outlookCalendar.update({ where: { id: ids.dadCal }, data: { leaseUntil: soon(1) } });
    await prisma.outlookCalendar.update({ where: { id: ids.ivyCal }, data: { lastFetchedAt: now } });
    await prisma.outlookCalendar.update({ where: { id: ids.family }, data: { retryAfterUntil: soon(1) } });
    expect(await claimStaleCalendars(ids.h, now)).toEqual([]);

    await prisma.outlookCalendar.updateMany({ where: { householdId: ids.h }, data: { lastFetchedAt: null, retryAfterUntil: null, leaseUntil: null } });
    await prisma.household.update({ where: { id: ids.h }, data: { disabledApps: ["calendar"] } });
    expect(await claimStaleCalendars(ids.h, now)).toEqual([]);
    await prisma.household.update({ where: { id: ids.h }, data: { disabledApps: [] } });

    const won = await claimStaleCalendars(ids.h, now);
    expect(won.map((c) => c.id).sort()).toEqual([ids.family, ids.dadCal, ids.ivyCal].sort());
    // A second visit at the same moment wins nothing.
    expect(await claimStaleCalendars(ids.h, now)).toEqual([]);
    await prisma.outlookCalendar.updateMany({ where: { householdId: ids.h }, data: { leaseUntil: null } });
  });

  test("a copy run elsewhere holds the lease: an admin's copy waits, and never frees the other's lease", async () => {
    const { claimStaleCalendars, refreshOutlookCalendar, ALREADY_COPYING } = await import("./copy");
    await prisma.outlookCalendar.update({ where: { id: ids.ivyCal }, data: { lastFetchedAt: null, leaseUntil: null, retryAfterUntil: null } });
    const [claim] = (await claimStaleCalendars(ids.h, now)).filter((c) => c.id === ids.ivyCal);
    expect(claim).toBeDefined();
    // The admin's Check access, while the job holds it.
    expect(await refreshOutlookCalendar(ids.ivyCal, { reader: reader({ ok: true, events: [], truncated: false }) })).toEqual({ ok: false, error: ALREADY_COPYING });
    expect((await prisma.outlookCalendar.findUniqueOrThrow({ where: { id: ids.ivyCal } })).leaseUntil?.getTime()).toBe(claim.lease.getTime());
    // The job's own run releases it.
    expect((await refreshOutlookCalendar(ids.ivyCal, { lease: claim.lease, reader: reader({ ok: true, events: [ev("soccer")], truncated: false }) })).ok).toBe(true);
    expect((await prisma.outlookCalendar.findUniqueOrThrow({ where: { id: ids.ivyCal } })).leaseUntil).toBeNull();
    await prisma.outlookCalendar.updateMany({ where: { householdId: ids.h }, data: { leaseUntil: null } });
  });

  test("a kid sees the family calendar and their own; a grown-up sees everyone's", async () => {
    const { refreshOutlookCalendar } = await import("./copy");
    const { getCopiedEvents } = await import("./view");
    await refreshOutlookCalendar(ids.dadCal, { reader: reader({ ok: true, events: [ev("work trip"), ev("doctor", { isPrivate: true, title: null })], truncated: false }) });
    await refreshOutlookCalendar(ids.ivyCal, { reader: reader({ ok: true, events: [ev("soccer")], truncated: false }) });
    const range = { start: now, end: soon(24) };
    const subjects = async (personId: string) => {
      const p = await prisma.person.findUniqueOrThrow({ where: { id: personId }, select: { id: true, householdId: true, role: true } });
      const r = await getCopiedEvents(p, range);
      return r.ok ? r.events.map((e) => e.subject).sort() : [];
    };
    expect(await subjects(ids.ivy)).toEqual(["picnic", "recital", "soccer"]);
    expect(await subjects(ids.max)).toEqual(["picnic", "recital"]);
    expect(await subjects(ids.mom)).toEqual(["Busy", "picnic", "recital", "soccer", "work trip"]);
    expect(await subjects(ids.dad)).toEqual(["Private", "picnic", "recital", "soccer", "work trip"]);
  });

  test("someone whose access ended loses their copy; a family calendar in their mailbox switches off", async () => {
    const { dropEndedCalendars, ACCESS_ENDED } = await import("./copy");
    const { getCopiedEvents } = await import("./view");
    await prisma.person.update({ where: { id: ids.mom }, data: { entraAccessEndedAt: now } });
    // Hidden at once, before the job runs.
    const dad = await prisma.person.findUniqueOrThrow({ where: { id: ids.dad }, select: { id: true, householdId: true, role: true } });
    const before = await getCopiedEvents(dad, { start: now, end: soon(24) });
    expect(before.ok && before.events.map((e) => e.subject)).not.toContain("picnic");

    await prisma.person.update({ where: { id: ids.ivy }, data: { isHouseholdMember: false } });
    expect(await dropEndedCalendars(now)).toBe(2);
    expect(await prisma.outlookCalendar.findUnique({ where: { id: ids.ivyCal } })).toBeNull();
    const family = await prisma.outlookCalendar.findUniqueOrThrow({ where: { id: ids.family } });
    expect(family).toMatchObject({ active: false, lastError: ACCESS_ENDED });
    expect(await prisma.outlookEvent.count({ where: { outlookCalendarId: ids.family } })).toBe(0);
    expect(await prisma.outlookCalendar.findUnique({ where: { id: ids.dadCal } })).not.toBeNull();
  });

  test("one family calendar per household", async () => {
    await expect(prisma.outlookCalendar.create({ data: { householdId: ids.h, kind: "FAMILY", personId: ids.dad, mailbox: "x@example.com" } })).rejects.toThrow();
  });
});
