import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import type { GraphResponse } from "@/lib/graph/client";
import { claimLease, runSync, type Graph } from "./run";

/**
 * A calendar sync run against a real database and a fake Graph (Phase 17): `npm run
 * test:db`. Skipped by plain `npm test`. A throwaway household, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

type Call = { method: string; path: string; body?: Record<string, unknown> };

/** Records every call; answers from `respond`, else a normal success. */
function fakeGraph(respond?: (call: Call, n: number) => GraphResponse | "throw" | undefined) {
  const calls: Call[] = [];
  let n = 0;
  const graph: Graph = async (method, path, body) => {
    const call = { method, path, body: body as Record<string, unknown> | undefined };
    calls.push(call);
    const custom = respond?.(call, n++);
    if (custom === "throw") throw new Error("network down");
    if (custom) return custom;
    if (method === "POST") return { status: 201, json: { id: `ev-${calls.length}` }, retryAfter: null };
    if (method === "PATCH") return { status: 200, json: {}, retryAfter: null };
    return { status: 204, json: null, retryAfter: null };
  };
  return { graph, calls };
}

describe.skipIf(!RUN)("calendar sync run (database)", () => {
  const ids = {} as { h: string; sync: string; date: string; item: string };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e calendar ${Date.now()}`, timezone: "America/New_York" } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const date = await prisma.importantDate.create({ data: { personId: mom.id, type: "BIRTHDAY", month: 5, day: 3, year: 1990 } });
    const vehicle = await prisma.vehicle.create({ data: { householdId: h.id, name: "Van" } });
    const item = await prisma.vehicleMaintenanceItem.create({
      data: { vehicleId: vehicle.id, title: "Oil change", intervalMonths: 6, lastDoneAt: new Date(2026, 5, 1) },
    });
    // Mileage-only: no date, so never on the calendar.
    await prisma.vehicleMaintenanceItem.create({ data: { vehicleId: vehicle.id, title: "Tires", intervalMiles: 5000, lastDoneMileage: 1 } });
    await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Dishes", domain: "CHORE", frequencyType: "DAILY", startDate: new Date(2026, 0, 1), timesOfDay: ["18:00"] },
    });
    const sync = await prisma.calendarSync.create({ data: { householdId: h.id, ownerPersonId: mom.id, calendarId: "cal-1", calendarName: "Test" } });
    Object.assign(ids, { h: h.id, sync: sync.id, date: date.id, item: item.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const links = () => prisma.calendarEventLink.findMany({ where: { syncId: ids.sync }, orderBy: { sourceKey: "asc" } });

  test("first run creates dated events only, tagged and idempotent", async () => {
    const { graph, calls } = fakeGraph();
    const r = await runSync({ syncId: ids.sync, graph });
    expect(r).toMatchObject({ status: "done", created: 2, updated: 0, deleted: 0, error: null });
    expect(calls.every((c) => c.method === "POST" && c.path === "/me/calendars/cal-1/events")).toBe(true);
    expect(calls[0].body).toHaveProperty("transactionId");
    expect(calls[0].body).toHaveProperty("singleValueExtendedProperties");
    expect((await links()).map((l) => [l.sourceKey, l.graphEventId !== null])).toEqual([
      [`date:${ids.date}`, true],
      [`vehicle:${ids.item}`, true],
    ]);
    const sync = await prisma.calendarSync.findUniqueOrThrow({ where: { id: ids.sync } });
    expect(sync).toMatchObject({ leaseUntil: null, lastError: null, lastResult: "2 added, 0 updated, 0 removed" });

    const again = fakeGraph();
    expect(await runSync({ syncId: ids.sync, graph: again.graph })).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(again.calls).toHaveLength(0);
  });

  test("a changed source is patched; one deleted by hand in Outlook is recreated", async () => {
    await prisma.importantDate.update({ where: { id: ids.date }, data: { day: 4 } });
    const patched = fakeGraph();
    expect(await runSync({ syncId: ids.sync, graph: patched.graph })).toMatchObject({ updated: 1 });
    expect(patched.calls.map((c) => c.method)).toEqual(["PATCH"]);

    await prisma.importantDate.update({ where: { id: ids.date }, data: { day: 5 } });
    const gone = fakeGraph((c) => (c.method === "PATCH" ? { status: 404, json: null, retryAfter: null } : undefined));
    expect(await runSync({ syncId: ids.sync, graph: gone.graph })).toMatchObject({ created: 1, updated: 0 });
    expect(gone.calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
  });

  test("a crash mid-create is retried with the same transactionId", async () => {
    await prisma.calendarSync.update({ where: { id: ids.sync }, data: { includeChores: true } });
    const crash = fakeGraph((c) => (c.method === "POST" ? "throw" : undefined));
    await expect(runSync({ syncId: ids.sync, graph: crash.graph })).rejects.toThrow("network down");
    // The lease was released even though the run threw.
    expect((await prisma.calendarSync.findUniqueOrThrow({ where: { id: ids.sync } })).leaseUntil).toBeNull();
    const pending = (await links()).find((l) => l.graphEventId === null)!;
    expect(pending.sourceKey).toMatch(/^chore:/);

    const retry = fakeGraph();
    const r = await runSync({ syncId: ids.sync, graph: retry.graph });
    expect(r.status).toBe("done");
    const retried = retry.calls.find((c) => c.method === "POST" && c.body?.singleValueExtendedProperties && JSON.stringify(c.body).includes(pending.sourceKey));
    expect(retried?.body?.transactionId).toBe(pending.transactionId);
    // Two weeks of timed chores now on the calendar.
    expect((await links()).filter((l) => l.sourceKey.startsWith("chore:")).length).toBeGreaterThanOrEqual(14);
  });

  test("throttling stops the run and backs off; turning a category off deletes its events", async () => {
    await prisma.calendarSync.update({ where: { id: ids.sync }, data: { includeChores: false } });
    const slow = fakeGraph((_c, n) => (n >= 2 ? { status: 429, json: null, retryAfter: 120 } : undefined));
    const r = await runSync({ syncId: ids.sync, graph: slow.graph });
    expect(r).toMatchObject({ status: "done", deleted: 2 });
    expect(r.status === "done" && r.remaining).toBeGreaterThan(0);
    const sync = await prisma.calendarSync.findUniqueOrThrow({ where: { id: ids.sync } });
    expect(sync.retryAfterUntil!.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(sync.lastError).toMatch(/slow down/);

    const rest = fakeGraph();
    await runSync({ syncId: ids.sync, graph: rest.graph });
    expect((await links()).some((l) => l.sourceKey.startsWith("chore:"))).toBe(false);
  });

  test("an event whose create reply was lost is found by its tag, deleted or adopted", async () => {
    // A lost create for a source that's since gone: the delete finds the event by its tag.
    await prisma.calendarEventLink.create({ data: { syncId: ids.sync, sourceKey: "chore:gone", graphEventId: null, contentHash: "x", transactionId: "t-gone" } });
    const orphan = fakeGraph((c) => (c.method === "GET" ? { status: 200, json: { value: [{ id: "ev-orphan" }] }, retryAfter: null } : undefined));
    await runSync({ syncId: ids.sync, graph: orphan.graph });
    expect(orphan.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual(["GET /me/calendars/cal-1/events", "DELETE /me/events/ev-orphan"]);
    expect(decodeURIComponent(orphan.calls[0].path)).toContain("ep/value eq 'chore:gone'");

    // A retried create Graph refuses: adopt the event the first attempt made.
    await prisma.calendarEventLink.update({
      where: { syncId_sourceKey: { syncId: ids.sync, sourceKey: `date:${ids.date}` } },
      data: { graphEventId: null, transactionId: "t-date" },
    });
    const adopt = fakeGraph((c) =>
      c.method === "POST" ? { status: 409, json: null, retryAfter: null } : c.method === "GET" ? { status: 200, json: { value: [{ id: "ev-first" }] }, retryAfter: null } : undefined,
    );
    expect(await runSync({ syncId: ids.sync, graph: adopt.graph })).toMatchObject({ created: 1, error: null });
    expect((await links()).find((l) => l.sourceKey === `date:${ids.date}`)?.graphEventId).toBe("ev-first");
  });

  test("only one run at a time", async () => {
    expect(await claimLease(ids.sync)).toBe(true);
    expect(await claimLease(ids.sync)).toBe(false);
    expect(await runSync({ syncId: ids.sync, graph: fakeGraph().graph })).toEqual({ status: "skipped", reason: "busy" });
    await prisma.calendarSync.update({ where: { id: ids.sync }, data: { leaseUntil: null } });
  });
});
