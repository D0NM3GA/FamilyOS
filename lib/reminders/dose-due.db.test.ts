import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 68a against a real database (`npm run test:db`): a dose that's due reminds only the
 * grown-ups who switched it on (and the kid), and a course past its last day switches itself off
 * once its last dose's missed-dose window has passed.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("doses due and courses that end (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", def: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-dose-due-${t}` } });
    const person = (firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, mom, ivy] = await Promise.all([person("Dad", "ADMIN"), person("Mom", "ADULT"), person("Ivy", "KID")]);
    await prisma.reminderPrefs.create({ data: { personId: mom.id, optIn: ["REMINDER_DOSE_DUE"] } });
    const def = await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Amoxicillin", domain: "MED", frequencyType: "DAILY", interval: 1, timesOfDay: ["08:00"], startDate: addDays(atMidnight(new Date()), 5), assignees: { connect: [{ id: ivy.id }] } },
    });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, def: def.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("a dose due in ten minutes reminds Mom (who opted in) and Ivy, not Dad", async () => {
    const { remindHousehold } = await import("./run");
    const now = new Date();
    await prisma.taskInstance.create({ data: { definitionId: ids.def, dueDate: new Date(now.getTime() + 10 * 60_000), assignedToId: ids.ivy } });
    await remindHousehold(ids.h, now);
    const due = async (personId: string) => prisma.notification.count({ where: { recipientId: personId, kind: "REMINDER_DOSE_DUE" } });
    expect(await due(ids.mom)).toBe(1);
    expect(await due(ids.ivy)).toBe(1);
    expect(await due(ids.dad)).toBe(0);
  });

  test("a course switches off the night after its last day, once the missed window is past", async () => {
    const { endFinishedCourses } = await import("./run");
    const lastDay = atMidnight(new Date(2026, 10, 10));
    await prisma.taskDefinition.update({ where: { id: ids.def }, data: { startDate: new Date(2026, 10, 1), endDate: lastDay, active: true } });
    // 23:30 on the last day, and 1:00 the next morning: still on (a late dose's missed reminder).
    expect(await endFinishedCourses(ids.h, new Date(2026, 10, 10, 23, 30))).toBe(0);
    expect(await endFinishedCourses(ids.h, new Date(2026, 10, 11, 1, 0))).toBe(0);
    expect(await endFinishedCourses(ids.h, new Date(2026, 10, 11, 2, 0))).toBe(1);
    expect((await prisma.taskDefinition.findUniqueOrThrow({ where: { id: ids.def } })).active).toBe(false);
  });

  test("a course ending today plans nothing after today", async () => {
    const { ensureInstancesGenerated } = await import("@/lib/tasks/instances");
    const today = atMidnight(new Date());
    await prisma.taskInstance.deleteMany({ where: { definitionId: ids.def } });
    await prisma.taskDefinition.update({ where: { id: ids.def }, data: { startDate: addDays(today, -3), endDate: today, active: true } });
    await ensureInstancesGenerated(ids.h, addDays(today, 7), "MED");
    expect(await prisma.taskInstance.count({ where: { definitionId: ids.def, dueDate: { gte: addDays(today, 1) } } })).toBe(0);
    expect(await prisma.taskInstance.count({ where: { definitionId: ids.def, dueDate: { gte: today, lt: addDays(today, 1) } } })).toBe(1);
  });
});
