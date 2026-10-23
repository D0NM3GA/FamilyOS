import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { atMidnight, addDays } from "./schedule";
import { ensureInstancesGenerated } from "./instances";

/**
 * The board's roll-forward against a real database: `npm run test:db`. Skipped by plain
 * `npm test`. A throwaway household, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("ensureInstancesGenerated (database)", () => {
  const ids = {} as { h: string; a: string; b: string; daily: string; old: string };
  const today = atMidnight(new Date());

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e instances ${Date.now()}` } });
    const a = await prisma.person.create({ data: { householdId: h.id, firstName: "A", isHouseholdMember: true, role: "KID" } });
    const b = await prisma.person.create({ data: { householdId: h.id, firstName: "B", isHouseholdMember: true, role: "KID" } });
    const daily = await prisma.taskDefinition.create({
      data: {
        householdId: h.id,
        title: "Feed the cat",
        frequencyType: "DAILY",
        startDate: addDays(today, -3),
        assignmentStrategy: "ROUND_ROBIN",
        assignees: { connect: [{ id: a.id }, { id: b.id }] },
      },
    });
    // A long-running chore with a year of history, to prove only the recent window is read
    // and generation still picks up from the latest one.
    const old = await prisma.taskDefinition.create({
      data: {
        householdId: h.id,
        title: "Water plants",
        frequencyType: "DAILY",
        startDate: addDays(today, -400),
        assignmentStrategy: "FIXED",
        assignees: { connect: [{ id: a.id }] },
      },
    });
    await prisma.taskInstance.createMany({
      data: Array.from({ length: 400 }, (_, i) => ({ definitionId: old.id, dueDate: addDays(today, -400 + i), assignedToId: a.id, status: "DONE" as const })),
    });
    Object.assign(ids, { h: h.id, a: a.id, b: b.id, daily: daily.id, old: old.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const instancesOf = (definitionId: string) =>
    prisma.taskInstance.findMany({ where: { definitionId }, orderBy: { dueDate: "asc" }, select: { dueDate: true, assignedToId: true } });

  test("fills in from the start date to the horizon, rotating, and is safe to run twice at once", async () => {
    const horizon = addDays(today, 2);
    await Promise.all([
      ensureInstancesGenerated(ids.h, horizon, "CHORE"),
      ensureInstancesGenerated(ids.h, horizon, "CHORE"),
    ]);
    const rows = await instancesOf(ids.daily);
    expect(rows.map((r) => r.dueDate.getTime())).toEqual([-3, -2, -1, 0, 1, 2].map((d) => addDays(today, d).getTime()));
    // Round robin alternates between the two kids.
    for (let i = 1; i < rows.length; i++) expect(rows[i].assignedToId).not.toBe(rows[i - 1].assignedToId);
  });

  test("a later horizon only adds what's missing", async () => {
    await ensureInstancesGenerated(ids.h, addDays(today, 4), "CHORE");
    const rows = await instancesOf(ids.daily);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.dueDate.getTime())).size).toBe(8);
  });

  test("picks up after a long history without re-creating any of it", async () => {
    // The tests above already rolled every chore out to today + 4.
    const rows = await instancesOf(ids.old);
    expect(rows.map((r) => r.dueDate.getTime())).toEqual(Array.from({ length: 405 }, (_, i) => addDays(today, -400 + i).getTime()));
  });

  test("another domain's board leaves chores alone", async () => {
    const before = await prisma.taskInstance.count({ where: { definition: { householdId: ids.h } } });
    await ensureInstancesGenerated(ids.h, addDays(today, 30), "MED");
    expect(await prisma.taskInstance.count({ where: { definition: { householdId: ids.h } } })).toBe(before);
  });
});
