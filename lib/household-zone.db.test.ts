import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyProcessZone, lockStoredDays, moveStoredDays, processZone, syncHouseholdZone, withStoredDays } from "./household-zone";

/**
 * Phase 49 against a real database (`npm run test:db`): stored days keep their date and clock
 * time when the household's zone changes, the instance index never trips halfway, instants and
 * connector rows stay put, an upgraded install is moved once, and instance writers wait out a move.
 * Vitest runs in America/New_York (vitest.config.ts), the "deploy's" zone here.
 */
const RUN = import.meta.env.MODE === "db";

/** A UTC instant from an ISO string, to compare stored values exactly. */
const at = (iso: string) => new Date(iso);

describe.skipIf(!RUN)("moving stored days between zones (database)", () => {
  const households: string[] = [];

  async function family(data: { timezone?: string | null; dayZone?: string | null } = {}) {
    const h = await prisma.household.create({ data: { name: `e2e zone ${Date.now()}-${households.length}`, ...data } });
    households.push(h.id);
    return h.id;
  }

  async function definition(householdId: string, startDate: Date, timesOfDay: string[] = []) {
    return prisma.taskDefinition.create({
      data: { householdId, title: "Feed the fish", domain: timesOfDay.length ? "MED" : "CHORE", frequencyType: "DAILY", startDate, timesOfDay },
    });
  }

  const dues = async (definitionId: string) =>
    (await prisma.taskInstance.findMany({ where: { definitionId }, orderBy: { dueDate: "asc" }, select: { dueDate: true, status: true } })).map((i) => ({
      due: i.dueDate.toISOString(),
      status: i.status,
    }));

  const move = (householdId: string, from: string, to: string) => prisma.$transaction((tx) => moveStoredDays(tx, householdId, from, to));

  beforeEach(() => {
    applyProcessZone(null);
  });
  afterEach(() => {
    applyProcessZone(null);
  });
  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: households } } });
  });

  test("a day keeps its date across a DST change, and a dose keeps its clock time", async () => {
    const h = await family();
    // Midnight, New York, on the day its clocks go forward (EST until 2 AM).
    const chore = await definition(h, at("2026-03-08T05:00:00Z"));
    await prisma.taskInstance.create({ data: { definitionId: chore.id, dueDate: at("2026-03-08T05:00:00Z") } });
    // 8 AM in New York in July (EDT).
    const med = await definition(h, at("2026-07-01T04:00:00Z"), ["08:00"]);
    await prisma.taskInstance.create({ data: { definitionId: med.id, dueDate: at("2026-07-01T12:00:00Z") } });

    const counts = await move(h, "America/New_York", "Europe/London");

    expect(counts).toMatchObject({ task_definition: 2, task_instance: 2 });
    // Midnight in London on the same dates (GMT in March, BST in July).
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: chore.id } })).startDate).toEqual(at("2026-03-08T00:00:00Z"));
    expect(await dues(chore.id)).toEqual([{ due: "2026-03-08T00:00:00.000Z", status: "PENDING" }]);
    expect(await dues(med.id)).toEqual([{ due: "2026-07-01T07:00:00.000Z", status: "PENDING" }]);
  });

  test("a 12-hour move of morning and evening doses doesn't collide halfway", async () => {
    const h = await family();
    const med = await definition(h, at("2026-01-05T05:00:00Z"), ["08:00", "20:00"]);
    // 8 AM and 8 PM in New York (EST, UTC-5). Bangkok (UTC+7) is exactly 12 hours ahead, so one
    // dose's new time is another's old time.
    await prisma.taskInstance.createMany({
      data: [
        { definitionId: med.id, dueDate: at("2026-01-05T13:00:00Z") },
        { definitionId: med.id, dueDate: at("2026-01-06T01:00:00Z") },
        { definitionId: med.id, dueDate: at("2026-01-06T13:00:00Z") },
      ],
    });

    await move(h, "America/New_York", "Asia/Bangkok");

    // 8 AM and 8 PM in Bangkok on the same dates.
    expect((await dues(med.id)).map((d) => d.due)).toEqual(["2026-01-05T01:00:00.000Z", "2026-01-05T13:00:00.000Z", "2026-01-06T01:00:00.000Z"]);
  });

  test("two doses that land on the same time (a skipped hour) keep one, the done one", async () => {
    const h = await family();
    const med = await definition(h, at("2026-03-29T04:00:00Z"), ["01:30", "02:30"]);
    // 1:30 and 2:30 AM in New York (EDT) on the night London's clocks skip from 1 to 2 AM: 1:30
    // doesn't exist there, so it becomes 2:30 BST, where the other dose lands too.
    await prisma.taskInstance.createMany({
      data: [
        { definitionId: med.id, dueDate: at("2026-03-29T05:30:00Z"), status: "PENDING" },
        { definitionId: med.id, dueDate: at("2026-03-29T06:30:00Z"), status: "DONE" },
      ],
    });

    await move(h, "America/New_York", "Europe/London");

    expect(await dues(med.id)).toEqual([{ due: "2026-03-29T01:30:00.000Z", status: "DONE" }]);
  });

  test("instants, connector rows and timed prices stay put; typed-in rows and receipt days move", async () => {
    const h = await family();
    const kid = await prisma.person.create({ data: { householdId: h, firstName: "Ivy", isHouseholdMember: true } });
    const profile = await prisma.schoolProfile.create({ data: { personId: kid.id, schoolName: "Example Elementary" } });
    const done = at("2026-05-04T21:15:00Z");
    const typed = await prisma.schoolAssignment.create({
      data: { profileId: profile.id, className: "Math", title: "Fractions", dueDate: at("2026-05-05T04:00:00Z"), doneAt: done, status: "DONE" },
    });
    const fed = await prisma.schoolAssignment.create({
      data: { profileId: profile.id, className: "Art", title: "Clay", dueDate: at("2026-05-05T04:00:00Z"), source: "CANVAS" },
    });
    const product = await prisma.product.create({ data: { householdId: h, name: "Eggs", nameKey: `eggs ${h}` } });
    const receiptDay = await prisma.itemPrice.create({ data: { householdId: h, productId: product.id, totalCents: 399, observedAt: at("2026-05-05T04:00:00Z") } });
    const tripTime = await prisma.itemPrice.create({ data: { householdId: h, productId: product.id, totalCents: 389, observedAt: at("2026-05-05T17:42:13.120Z") } });

    await move(h, "America/New_York", "America/Los_Angeles");

    const typedNow = await prisma.schoolAssignment.findUniqueOrThrow({ where: { id: typed.id } });
    expect(typedNow.dueDate).toEqual(at("2026-05-05T07:00:00Z"));
    expect(typedNow.doneAt).toEqual(done);
    expect((await prisma.schoolAssignment.findUniqueOrThrow({ where: { id: fed.id } })).dueDate).toEqual(at("2026-05-05T04:00:00Z"));
    expect((await prisma.itemPrice.findUniqueOrThrow({ where: { id: receiptDay.id } })).observedAt).toEqual(at("2026-05-05T07:00:00Z"));
    expect((await prisma.itemPrice.findUniqueOrThrow({ where: { id: tripTime.id } })).observedAt).toEqual(at("2026-05-05T17:42:13.120Z"));
  });

  test("only the one household's days move", async () => {
    const mine = await family();
    const theirs = await family();
    const a = await definition(mine, at("2026-05-05T04:00:00Z"));
    const b = await definition(theirs, at("2026-05-05T04:00:00Z"));
    await move(mine, "America/New_York", "UTC");
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: a.id } })).startDate).toEqual(at("2026-05-05T00:00:00Z"));
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: b.id } })).startDate).toEqual(at("2026-05-05T04:00:00Z"));
  });

  test("an upgraded install (a zone, no dayZone) is moved once from the deploy's zone, then left alone", async () => {
    const h = await family({ timezone: "Europe/London", dayZone: null });
    const chore = await definition(h, at("2026-05-05T04:00:00Z"));

    const first = await syncHouseholdZone(h);
    expect(first).toMatchObject({ from: "America/New_York", to: "Europe/London" });
    expect(processZone()).toBe("Europe/London");
    expect((await prisma.household.findUniqueOrThrow({ where: { id: h } })).dayZone).toBe("Europe/London");
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: chore.id } })).startDate).toEqual(at("2026-05-04T23:00:00Z"));

    expect(await syncHouseholdZone(h)).toBeNull();
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: chore.id } })).startDate).toEqual(at("2026-05-04T23:00:00Z"));
  });

  test("a household without a zone stays on the deploy's", async () => {
    const h = await family({ timezone: null });
    applyProcessZone("Asia/Tokyo");
    expect(await syncHouseholdZone(h)).toBeNull();
    expect(processZone()).toBe("America/New_York");
  });

  test("an instance writer waits until a move has committed", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const mover = prisma.$transaction(async (tx) => {
      await lockStoredDays(tx);
      locked();
      await held;
      order.push("move committed");
    });
    await isLocked;
    const writer = withStoredDays(async () => {
      order.push("writer ran");
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(order).toEqual([]);
    release();
    await Promise.all([mover, writer]);
    expect(order).toEqual(["move committed", "writer ran"]);
  });
});
