import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 62 against a real database (`npm run test:db`): one household's reminders go once per
 * person and thing, quiet hours hold all but a missed dose until they end, a kid gets the bell
 * only, and a restocked medicine reminds again the next time it runs low.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("reminders (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", med: "" };
  const now = new Date();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-reminders-${t}` } });
    const person = (firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, mom, ivy] = await Promise.all([person("Dad", "ADMIN"), person("Mom", "ADULT"), person("Ivy", "KID")]);
    const grandma = await prisma.person.create({ data: { householdId: h.id, firstName: "Grandma", isHouseholdMember: false } });
    const soon = addDays(atMidnight(now), 3);
    await prisma.importantDate.create({ data: { personId: grandma.id, type: "BIRTHDAY", month: soon.getMonth() + 1, day: soon.getDate() } });
    // Starts tomorrow, so the job's own top-up makes nothing inside the missed window.
    const def = await prisma.taskDefinition.create({
      data: {
        householdId: h.id,
        title: "Amoxicillin",
        domain: "MED",
        frequencyType: "DAILY",
        interval: 1,
        timesOfDay: ["08:00"],
        startDate: addDays(atMidnight(now), 1),
        medication: { create: { quantityOnHand: 3, doseAmount: 1 } },
      },
      include: { medication: true },
    });
    await prisma.taskInstance.create({ data: { definitionId: def.id, dueDate: new Date(now.getTime() - 2 * 60 * 60_000), assignedToId: ivy.id } });
    await prisma.schoolTask.create({ data: { householdId: h.id, title: "field trip form", kind: "FORM", dueDate: addDays(atMidnight(now), 1), kidPersonId: ivy.id } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, med: def.medication!.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const bell = async (personId: string) => (await prisma.notification.findMany({ where: { recipientId: personId }, select: { kind: true } })).map((n) => n.kind).sort();

  test("quiet hours hold everything but the missed dose; each goes once; a kid gets her dose", async () => {
    const { remindHousehold } = await import("./run");
    const m = now.getHours() * 60 + now.getMinutes();
    await prisma.reminderPrefs.create({ data: { personId: ids.mom, quietStart: (m + 1440 - 60) % 1440, quietEnd: (m + 60) % 1440 } });

    expect(await remindHousehold(ids.h, now)).toBe(6);
    expect(await bell(ids.dad)).toEqual(["REMINDER_DATE", "REMINDER_DOSE", "REMINDER_MED_LOW", "REMINDER_SCHOOL"]);
    expect(await bell(ids.mom)).toEqual(["REMINDER_DOSE"]);
    expect(await bell(ids.ivy)).toEqual(["REMINDER_DOSE"]);
    const dose = await prisma.notification.findFirstOrThrow({ where: { recipientId: ids.ivy } });
    expect(dose.title).toMatch(/^Ivy's .* dose of Amoxicillin wasn't marked$/);

    // Nothing new on the next tick; Mom's held ones come once her quiet hours are over.
    expect(await remindHousehold(ids.h, now)).toBe(0);
    await prisma.reminderPrefs.update({ where: { personId: ids.mom }, data: { quietStart: null, quietEnd: null } });
    expect(await remindHousehold(ids.h, now)).toBe(3);
    expect(await bell(ids.mom)).toEqual(["REMINDER_DATE", "REMINDER_DOSE", "REMINDER_MED_LOW", "REMINDER_SCHOOL"]);
  });

  test("a kind switched off stays quiet; restocking forgets the low reminder", async () => {
    const { remindHousehold } = await import("./run");
    await prisma.notification.deleteMany({ where: { householdId: ids.h } });
    await prisma.reminderPrefs.upsert({ where: { personId: ids.dad }, create: { personId: ids.dad, off: ["REMINDER_MED_LOW"] }, update: { off: ["REMINDER_MED_LOW"] } });

    await prisma.medication.update({ where: { id: ids.med }, data: { quantityOnHand: 100 } });
    expect(await remindHousehold(ids.h, now)).toBe(0);
    expect(await prisma.reminderSent.count({ where: { key: `med:${ids.med}` } })).toBe(0);

    await prisma.medication.update({ where: { id: ids.med }, data: { quantityOnHand: 2 } });
    expect(await remindHousehold(ids.h, now)).toBe(1);
    expect(await bell(ids.mom)).toEqual(["REMINDER_MED_LOW"]);
    expect(await bell(ids.dad)).toEqual([]);
  });

  test("a stopped job reminds the admins only, once (Phase 67b)", async () => {
    const { remindHousehold } = await import("./run");
    await prisma.notification.deleteMany({ where: { householdId: ids.h } });
    await prisma.reminderPrefs.deleteMany({ where: { personId: ids.dad } });
    const lastOk = new Date(now.getTime() - 3 * 60 * 60_000);
    const before = await prisma.systemHeartbeat.findUnique({ where: { name: "purges" } });
    await prisma.systemHeartbeat.upsert({
      where: { name: "purges" },
      create: { name: "purges", lastOkAt: lastOk, lastErrorAt: new Date(now.getTime() - 60_000), lastError: "Error", updatedAt: now },
      update: { lastOkAt: lastOk, lastErrorAt: new Date(now.getTime() - 60_000), lastError: "Error", updatedAt: now },
    });
    try {
      await remindHousehold(ids.h, now);
      await remindHousehold(ids.h, new Date(now.getTime() + 30 * 60_000));
      expect((await bell(ids.dad)).filter((k) => k === "REMINDER_SYSTEM")).toHaveLength(1);
      expect(await bell(ids.mom)).not.toContain("REMINDER_SYSTEM");
      expect(await bell(ids.ivy)).not.toContain("REMINDER_SYSTEM");
    } finally {
      if (before) await prisma.systemHeartbeat.update({ where: { name: "purges" }, data: before });
      else await prisma.systemHeartbeat.delete({ where: { name: "purges" } });
    }
  });
});
