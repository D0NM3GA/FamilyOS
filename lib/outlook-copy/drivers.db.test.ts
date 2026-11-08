import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CopiedEvent } from "@/lib/graph/app-calendar";

/**
 * Phase 70b against a real database (`npm run test:db`): grown-ups set who's driving to a timed
 * copied event, only a grown-up of the household drives, a driver survives the copy being replaced
 * and a brief miss, and goes once the event is gone and past; someone cut off stops driving.
 */
const RUN = import.meta.env.MODE === "db";
vi.mock("next/server", () => ({ after: () => {} }));

describe.skipIf(!RUN)("who's driving (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", other: "", dad: "", mom: "", ivy: "", cal: "", otherCal: "" };
  const now = new Date();
  const soon = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const ev = (graphId: string, extra: Partial<CopiedEvent> = {}): CopiedEvent => ({ graphId, iCalUId: null, title: graphId, location: null, startsAt: soon(2), endsAt: soon(3), allDay: false, isPrivate: false, ...extra });
  const profile = (id: string) => prisma.person.findUniqueOrThrow({ where: { id }, select: { id: true, householdId: true, role: true } });

  beforeAll(async () => {
    const [h, other] = await Promise.all([prisma.household.create({ data: { name: `e2e-drivers-${t}` } }), prisma.household.create({ data: { name: `e2e-drivers-other-${t}` } })]);
    const mk = (householdId: string, firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId, firstName, role, isHouseholdMember: true } });
    const [dad, mom, ivy, stranger] = await Promise.all([mk(h.id, "Dad", "ADMIN"), mk(h.id, "Mom", "ADULT"), mk(h.id, "Ivy", "KID"), mk(other.id, "Example", "ADMIN")]);
    const cal = await prisma.outlookCalendar.create({ data: { householdId: h.id, kind: "FAMILY", personId: mom.id, mailbox: "mom@example.com" } });
    const otherCal = await prisma.outlookCalendar.create({ data: { householdId: other.id, kind: "FAMILY", personId: stranger.id, mailbox: "x@example.com" } });
    Object.assign(ids, { h: h.id, other: other.id, dad: dad.id, mom: mom.id, ivy: ivy.id, cal: cal.id, otherCal: otherCal.id });
    const { refreshOutlookCalendar } = await import("./copy");
    await refreshOutlookCalendar(cal.id, { reader: async () => ({ ok: true, events: [ev("soccer"), ev("field trip", { allDay: true })], truncated: false }) });
    await refreshOutlookCalendar(otherCal.id, { reader: async () => ({ ok: true, events: [ev("theirs")], truncated: false }) });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("a grown-up sets a grown-up driver on a timed event; everyone sees it", async () => {
    const { setEventDriver } = await import("./drivers");
    const { getCopiedEvents } = await import("./view");
    expect(await setEventDriver(await profile(ids.mom), ids.cal, "soccer", ids.dad)).toEqual({ ok: true });
    const r = await getCopiedEvents(await profile(ids.ivy), { start: now, end: soon(24) });
    expect(r.ok && r.events.find((e) => e.subject === "soccer")?.driver).toBe("Dad");
  });

  test("refused: a kid setting it, a kid driving, an all-day event, another household's calendar", async () => {
    const { setEventDriver } = await import("./drivers");
    expect((await setEventDriver(await profile(ids.ivy), ids.cal, "soccer", ids.mom)).ok).toBe(false);
    expect(await setEventDriver(await profile(ids.mom), ids.cal, "soccer", ids.ivy)).toEqual({ ok: false, error: "Pick one of the family's grown-ups." });
    expect((await setEventDriver(await profile(ids.mom), ids.cal, "field trip", ids.dad)).ok).toBe(false);
    expect((await setEventDriver(await profile(ids.dad), ids.otherCal, "theirs", ids.dad)).ok).toBe(false);
    expect(await prisma.eventDriver.count({ where: { outlookCalendarId: ids.otherCal } })).toBe(0);
    expect((await prisma.eventDriver.findFirstOrThrow({ where: { outlookCalendarId: ids.cal, graphId: "soccer" } })).personId).toBe(ids.dad);
  });

  test("a driver survives a replace and a brief miss, and goes once the event is gone and past", async () => {
    const { refreshOutlookCalendar } = await import("./copy");
    const moved = soon(5);
    await refreshOutlookCalendar(ids.cal, { reader: async () => ({ ok: true, events: [ev("soccer", { startsAt: soon(4), endsAt: moved })], truncated: false }) });
    expect((await prisma.eventDriver.findFirstOrThrow({ where: { graphId: "soccer", outlookCalendarId: ids.cal } })).endsAt.getTime()).toBe(moved.getTime());
    // Missing from one read, still ahead: kept.
    await refreshOutlookCalendar(ids.cal, { reader: async () => ({ ok: true, events: [], truncated: false }) });
    expect(await prisma.eventDriver.count({ where: { outlookCalendarId: ids.cal } })).toBe(1);
    // Missing and ended before the window (a week back): gone.
    await prisma.eventDriver.updateMany({ where: { outlookCalendarId: ids.cal }, data: { endsAt: new Date(now.getTime() - 8 * 86_400_000) } });
    await refreshOutlookCalendar(ids.cal, { reader: async () => ({ ok: true, events: [], truncated: false }) });
    expect(await prisma.eventDriver.count({ where: { outlookCalendarId: ids.cal } })).toBe(0);
  });

  test("clearing it, and a cut-off driver stops driving", async () => {
    const { refreshOutlookCalendar, dropEndedCalendars } = await import("./copy");
    const { setEventDriver } = await import("./drivers");
    await refreshOutlookCalendar(ids.cal, { reader: async () => ({ ok: true, events: [ev("soccer")], truncated: false }) });
    expect(await setEventDriver(await profile(ids.mom), ids.cal, "soccer", ids.dad)).toEqual({ ok: true });
    expect(await setEventDriver(await profile(ids.mom), ids.cal, "soccer", null)).toEqual({ ok: true });
    expect(await prisma.eventDriver.count({ where: { outlookCalendarId: ids.cal } })).toBe(0);
    await setEventDriver(await profile(ids.mom), ids.cal, "soccer", ids.dad);
    await prisma.person.update({ where: { id: ids.dad }, data: { entraAccessEndedAt: now } });
    await dropEndedCalendars(now);
    expect(await prisma.eventDriver.count({ where: { outlookCalendarId: ids.cal } })).toBe(0);
  });
});
