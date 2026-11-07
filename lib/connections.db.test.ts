import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { personConnections } from "@/lib/people";
import { searchHousehold } from "@/lib/search";

/**
 * Phase 63c against a real database (`npm run test:db`): a contact's page shows the medicines they
 * prescribe or fill and the students they're a school contact for; search opens a school to-do in
 * its panel and finds school calendar events (a kid only their own and the family's) and list items.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("connections and search (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", ivy: "", max: "", doctor: "", teacher: "", def: "", task: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-connections-${t}` } });
    const ivy = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const max = await prisma.person.create({ data: { householdId: h.id, firstName: "Max", role: "KID", isHouseholdMember: true } });
    const doctor = await prisma.person.create({ data: { householdId: h.id, firstName: "Dr", lastName: "Parker", isHouseholdMember: false } });
    const teacher = await prisma.person.create({ data: { householdId: h.id, firstName: "Ms", lastName: "Example", isHouseholdMember: false } });
    const def = await prisma.taskDefinition.create({
      data: {
        householdId: h.id,
        title: "Inhaler",
        domain: "MED",
        frequencyType: "DAILY",
        startDate: new Date(),
        assignees: { connect: [{ id: ivy.id }] },
        medication: { create: { prescriberId: doctor.id } },
      },
    });
    const schoolProfile = await prisma.schoolProfile.create({ data: { personId: ivy.id, schoolName: "Example Elementary" } });
    await prisma.schoolContact.create({ data: { profileId: schoolProfile.id, personId: teacher.id, role: "Homeroom teacher" } });
    // The doctor also fills a medicine (a pharmacy too), and prescribed one that's stopped.
    await prisma.taskDefinition.create({ data: { householdId: h.id, title: "Ear drops", domain: "MED", frequencyType: "DAILY", startDate: new Date(), medication: { create: { pharmacyId: doctor.id } } } });
    await prisma.taskDefinition.create({ data: { householdId: h.id, title: "Old cream", domain: "MED", frequencyType: "DAILY", startDate: new Date(), active: false, medication: { create: { prescriberId: doctor.id } } } });
    const task = await prisma.schoolTask.create({ data: { householdId: h.id, title: "Picture day form", kind: "FORM", kidPersonId: ivy.id } });
    const feed = (kidPersonId: string | null, n: number) =>
      prisma.schoolFeed.create({ data: { householdId: h.id, name: `Feed ${n}`, kidPersonId, encryptedValue: Buffer.from("x"), iv: Buffer.from("x"), authTag: Buffer.from("x"), urlHash: `hash-${n}-${t}`, host: "calendar.example.com" } });
    const [family, ivysFeed, maxsFeed, stopped] = await Promise.all([feed(null, 1), feed(ivy.id, 2), feed(max.id, 3), feed(null, 4)]);
    await prisma.schoolFeed.update({ where: { id: stopped.id }, data: { active: false } });
    const soon = new Date(Date.now() + 5 * 86_400_000);
    const far = new Date(Date.now() + 70 * 86_400_000);
    for (const [f, title, at] of [
      [family, "Picture day for everyone", soon],
      [ivysFeed, "Picture day, Ivy's class", soon],
      [maxsFeed, "Picture day, Max's class", soon],
      [stopped, "Picture day, an old feed", soon],
      [family, "Picture day retakes", far],
    ] as const) {
      await prisma.schoolFeedEvent.create({ data: { feedId: f.id, occurrenceKey: title, uid: title, title, startsAt: at, endsAt: new Date(at.getTime() + 3_600_000), allDay: false } });
    }
    const list = await prisma.shoppingList.create({ data: { householdId: h.id } });
    const product = await prisma.product.create({ data: { householdId: h.id, name: "Picture frame", nameKey: `picture frame ${t}` } });
    await prisma.shoppingListItem.create({ data: { listId: list.id, productId: product.id } });
    Object.assign(ids, { h: h.id, ivy: ivy.id, max: max.id, doctor: doctor.id, teacher: teacher.id, def: def.id, task: task.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("a doctor prescribes, a teacher teaches, and nothing shows for an app that's off", async () => {
    const doc = await personConnections(ids.doctor, ids.h, { meds: true, school: true });
    expect(doc.meds.map((m) => [m.title, m.as]).sort()).toEqual([
      ["Ear drops", "fills"],
      ["Inhaler", "prescribes"],
    ]);
    expect(doc.meds.find((m) => m.title === "Inhaler")).toEqual({ definitionId: ids.def, title: "Inhaler", as: "prescribes", whose: ["Ivy"] });
    expect(doc.school).toEqual([]);
    expect((await personConnections(ids.teacher, ids.h, { meds: true, school: true })).school).toEqual([{ role: "Homeroom teacher", studentId: ids.ivy, studentName: "Ivy" }]);
    expect(await personConnections(ids.doctor, ids.h, { meds: false, school: false })).toEqual({ meds: [], school: [] });
  });

  test("search: the to-do opens in its panel; a kid finds only their own and the family's events", async () => {
    const adult = await searchHousehold(ids.h, "picture day", { viewerIsAdult: true, disabledApps: [] });
    const forms = adult.find((g) => g.title === "School forms & to-dos")!;
    expect(forms.items[0].href).toBe(`/school?kid=${ids.ivy}&item=SCHOOL_TASK%3A${ids.task}`);
    // Not the stopped feed's, nor one more than 60 days off.
    expect(adult.find((g) => g.title === "School calendar")!.items).toHaveLength(3);
    const frame = await searchHousehold(ids.h, "frame", { viewerIsAdult: true, disabledApps: [] });
    expect(frame.find((g) => g.title === "On the shopping list")!.items.map((i) => i.label)).toEqual(["Picture frame"]);

    const kid = await searchHousehold(ids.h, "picture day", { viewerIsAdult: false, disabledApps: [], viewerId: ids.ivy });
    expect(kid.find((g) => g.title === "School forms & to-dos")).toBeUndefined();
    expect(kid.find((g) => g.title === "School calendar")!.items.map((i) => i.label).sort()).toEqual(["Picture day for everyone", "Picture day, Ivy's class"]);
  });
});
