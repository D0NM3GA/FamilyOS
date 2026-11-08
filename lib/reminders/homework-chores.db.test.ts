import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 68b against a real database (`npm run test:db`): a kid's quiz due tomorrow reminds the kid
 * and the grown-ups from 3 pm, and at 6 pm kids with open chores get a bell and the grown-ups a
 * line. Run at fixed times today, so "today" and "tomorrow" are the real ones.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("homework and chores reminders (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", mom: "", max: "", chore: "" };
  const today = atMidnight(new Date());
  const at = (h: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, 5);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-homework-${t}` } });
    const [mom, max] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Max", role: "KID", isHouseholdMember: true } }),
    ]);
    const profile = await prisma.schoolProfile.create({ data: { personId: max.id, schoolName: "Parker Elementary" } });
    await prisma.schoolAssignment.create({ data: { profileId: profile.id, className: "Math", title: "Fractions", kind: "QUIZ", dueDate: addDays(today, 1) } });
    const chore = await prisma.taskDefinition.create({
      data: { householdId: h.id, title: "Dishes", domain: "CHORE", frequencyType: "DAILY", interval: 1, startDate: today, assignees: { connect: [{ id: max.id }] } },
    });
    Object.assign(ids, { h: h.id, mom: mom.id, max: max.id, chore: chore.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const titles = async (personId: string, kind: "REMINDER_HOMEWORK" | "REMINDER_CHORES") =>
    (await prisma.notification.findMany({ where: { recipientId: personId, kind }, select: { title: true } })).map((n) => n.title).sort();

  test("homework from 3 pm, to the kid and the grown-up", async () => {
    const { remindHousehold } = await import("./run");
    await remindHousehold(ids.h, at(14));
    expect(await titles(ids.max, "REMINDER_HOMEWORK")).toEqual([]);
    await remindHousehold(ids.h, at(15));
    expect(await titles(ids.max, "REMINDER_HOMEWORK")).toEqual(["Max has a quiz due tomorrow: Fractions"]);
    expect(await titles(ids.mom, "REMINDER_HOMEWORK")).toEqual(["Max has a quiz due tomorrow: Fractions"]);
  });

  test("chores at 6 pm: the kid's bell and the grown-up's line, once", async () => {
    const { remindHousehold } = await import("./run");
    await remindHousehold(ids.h, at(18));
    await remindHousehold(ids.h, at(19));
    expect(await titles(ids.max, "REMINDER_CHORES")).toEqual(["1 chore still to do today"]);
    expect(await titles(ids.mom, "REMINDER_CHORES")).toEqual(["Still to do today: Max 1"]);
  });
});
