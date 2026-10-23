import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "./schedule";
import { getBoardInstances } from "./queries";
import { markOlderMissed, OVERDUE_WINDOW_DAYS, skipInstance, unskipInstance } from "./skip";

/**
 * Skip / Missed and the overdue window against a real database: `npm run test:db`. Skipped by
 * plain `npm test`. Throwaway households, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("skipping chores and doses (database)", () => {
  const ids = {} as { h: string; other: string; adult: string; chore: string; med: string };
  const today = atMidnight(new Date());
  const inst = (definitionId: string, offset: number, status: "PENDING" | "DONE" = "PENDING") =>
    prisma.taskInstance.create({ data: { definitionId, dueDate: addDays(today, offset), status } });

  beforeAll(async () => {
    const tag = Date.now();
    const h = await prisma.household.create({ data: { name: `e2e skip ${tag}` } });
    const other = await prisma.household.create({ data: { name: `e2e skip other ${tag}` } });
    const adult = await prisma.person.create({ data: { householdId: h.id, firstName: "Grown", isHouseholdMember: true, role: "ADULT" } });
    const def = (householdId: string, domain: "CHORE" | "MED") =>
      prisma.taskDefinition.create({ data: { householdId, title: domain, domain, frequencyType: "ONCE", startDate: addDays(today, -30) } });
    const chore = await def(h.id, "CHORE");
    const med = await def(h.id, "MED");
    Object.assign(ids, { h: h.id, other: other.id, adult: adult.id, chore: chore.id, med: med.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("skips only a pending one, in this household and domain, and can be undone", async () => {
    const pending = await inst(ids.chore, -1);
    const done = await inst(ids.chore, -2, "DONE");
    expect(await skipInstance({ householdId: ids.other, domain: "CHORE", instanceId: pending.id, byId: ids.adult })).toBe(false);
    expect(await skipInstance({ householdId: ids.h, domain: "MED", instanceId: pending.id, byId: ids.adult })).toBe(false);
    expect(await skipInstance({ householdId: ids.h, domain: "CHORE", instanceId: done.id, byId: ids.adult })).toBe(false);

    expect(await skipInstance({ householdId: ids.h, domain: "CHORE", instanceId: pending.id, byId: ids.adult })).toBe(true);
    expect(await prisma.taskInstance.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "SKIPPED", completedById: ids.adult });
    expect(await prisma.pointsLedger.count({ where: { instanceId: pending.id } })).toBe(0);

    expect(await unskipInstance({ householdId: ids.h, domain: "CHORE", instanceId: pending.id })).toBe(true);
    expect(await prisma.taskInstance.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "PENDING", completedById: null, completedAt: null });
  });

  test("the board shows a week of overdue and counts the rest, which one tap marks missed", async () => {
    const recent = await inst(ids.med, -OVERDUE_WINDOW_DAYS);
    const old = await Promise.all([inst(ids.med, -OVERDUE_WINDOW_DAYS - 1), inst(ids.med, -20)]);
    const board = await getBoardInstances(ids.h, { domain: "MED" });
    expect(board.overdue.map((i) => i.id)).toEqual([recent.id]);
    expect(board.olderMissed).toBe(2);

    expect(await markOlderMissed({ householdId: ids.other, domain: "MED", byId: ids.adult })).toBe(0);
    expect(await markOlderMissed({ householdId: ids.h, domain: "MED", byId: ids.adult })).toBe(2);
    const statuses = await prisma.taskInstance.findMany({ where: { id: { in: [recent.id, ...old.map((o) => o.id)] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [recent.id]: "PENDING",
      [old[0].id]: "SKIPPED",
      [old[1].id]: "SKIPPED",
    });
    expect((await getBoardInstances(ids.h, { domain: "MED" })).olderMissed).toBe(0);
  });

  test("\"my chores\" can include the Anyone ones", async () => {
    const sibling = await prisma.person.create({ data: { householdId: ids.h, firstName: "Sib", isHouseholdMember: true, role: "KID" } });
    const mine = await prisma.taskInstance.create({ data: { definitionId: ids.chore, dueDate: addDays(today, 1), assignedToId: ids.adult } });
    const anyone = await inst(ids.chore, 2);
    const theirs = await prisma.taskInstance.create({ data: { definitionId: ids.chore, dueDate: addDays(today, 3), assignedToId: sibling.id } });
    const onlyMine = await getBoardInstances(ids.h, { domain: "CHORE", personId: ids.adult });
    const withAnyone = await getBoardInstances(ids.h, { domain: "CHORE", personId: ids.adult, includeUnassigned: true });
    expect(onlyMine.upcoming.map((i) => i.id)).toEqual([mine.id]);
    // Someone else's chore never shows up in "mine", with or without the Anyone ones.
    expect(withAnyone.upcoming.map((i) => i.id)).toEqual([mine.id, anyone.id]);
    expect(withAnyone.upcoming.map((i) => i.id)).not.toContain(theirs.id);
  });

  test("on a board filtered to one person, only their older ones are marked", async () => {
    const theirs = await prisma.taskInstance.create({ data: { definitionId: ids.chore, dueDate: addDays(today, -20), assignedToId: ids.adult } });
    const unassigned = await inst(ids.chore, -21);
    expect((await getBoardInstances(ids.h, { domain: "CHORE", personId: ids.adult })).olderMissed).toBe(1);
    expect(await markOlderMissed({ householdId: ids.h, domain: "CHORE", byId: ids.adult, personId: ids.adult })).toBe(1);
    const after = await prisma.taskInstance.findMany({ where: { id: { in: [theirs.id, unassigned.id] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(after.map((s) => [s.id, s.status]))).toEqual({ [theirs.id]: "SKIPPED", [unassigned.id]: "PENDING" });
  });
});
