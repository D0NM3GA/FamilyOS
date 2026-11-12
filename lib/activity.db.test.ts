import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getHouseholdActivity } from "./activity";
import { getPersonWithDetails, staleContacts } from "./people";

/** Home's activity feed against a real database: `npm run test:db`. */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("activity feed and grown-ups-only calls (database)", () => {
  let h = "";
  let grandmaId = "";
  let ivyId = "";
  const called = new Date(Date.now() - 2 * 86_400_000);

  beforeAll(async () => {
    h = (await prisma.household.create({ data: { name: `e2e activity ${Date.now()}` } })).id;
    const grandma = await prisma.person.create({ data: { householdId: h, firstName: "Grandma" } });
    grandmaId = grandma.id;
    ivyId = (await prisma.person.create({ data: { householdId: h, firstName: "Ivy", role: "KID", isHouseholdMember: true } })).id;
    await prisma.interactionLog.createMany({
      data: [
        { personId: grandma.id, type: "CALL", note: "Birthday plans", occurredAt: called },
        // The newest one is the hidden one.
        { personId: grandma.id, type: "VISIT", note: "Talked about the will", adultsOnly: true },
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: h } });
  });

  test("kids' feed leaves out grown-ups-only ones; grown-ups see both", async () => {
    const kid = await getHouseholdActivity(h, 10, { viewerId: ivyId, viewerIsAdult: false });
    const adult = await getHouseholdActivity(h, 10, { viewerId: grandmaId, viewerIsAdult: true });
    expect(kid.map((e) => e.text)).toEqual(["Someone logged a call with Grandma"]);
    expect(adult.map((e) => e.text).sort()).toEqual(["Someone logged a call with Grandma", "Someone logged a visit with Grandma"]);
  });

  test("a kid's feed has their own doses and homework only, and no school forms", async () => {
    const when = new Date(Date.now() - 86_400_000);
    const def = (title: string, domain: "CHORE" | "MED") =>
      prisma.taskDefinition.create({ data: { householdId: h, title, domain, frequencyType: "DAILY", startDate: when } });
    const [chore, grandmaMed, ivyMed] = await Promise.all([def("Feed the cat", "CHORE"), def("Heart pill", "MED"), def("Allergy pill", "MED")]);
    const done = { status: "DONE" as const, completedAt: when, dueDate: when };
    await prisma.taskInstance.createMany({
      data: [
        { definitionId: chore.id, assignedToId: grandmaId, ...done },
        { definitionId: grandmaMed.id, assignedToId: grandmaId, ...done },
        { definitionId: ivyMed.id, assignedToId: ivyId, ...done },
      ],
    });
    await prisma.schoolTask.create({ data: { householdId: h, title: "Field trip form", status: "DONE", doneAt: when } });

    const kid = (await getHouseholdActivity(h, 20, { viewerId: ivyId, viewerIsAdult: false })).map((e) => e.text);
    expect(kid).toContain('Someone completed "Feed the cat"');
    expect(kid).toContain('Someone completed "Allergy pill"');
    expect(kid.join()).not.toContain("Heart pill");
    expect(kid.join()).not.toContain("Field trip form");
    const adult = (await getHouseholdActivity(h, 20, { viewerId: grandmaId, viewerIsAdult: true })).map((e) => e.text).join();
    expect(adult).toContain("Heart pill");
    expect(adult).toContain("Field trip form");
  });

  test("a kid's Haven't talked list goes by the calls they can see", async () => {
    // Grandma's visible call was 2 days ago; a cadence of 1 day makes her overdue to a kid,
    // while the grown-ups-only visit today keeps her off a grown-up's list.
    await prisma.person.update({ where: { id: grandmaId }, data: { contactCadenceDays: 1, lastContactedAt: new Date() } });
    expect((await staleContacts(h, { viewerIsAdult: true })).map((p) => p.id)).not.toContain(grandmaId);
    expect((await staleContacts(h, { viewerIsAdult: false })).map((p) => p.id)).toContain(grandmaId);
  });

  test("a kid's view of a person never loads the grown-ups-only calls", async () => {
    const kid = await getPersonWithDetails(grandmaId, h, { viewerIsAdult: false });
    const adult = await getPersonWithDetails(grandmaId, h, { viewerIsAdult: true });
    expect(kid?.interactions.map((i) => i.type)).toEqual(["CALL"]);
    // The person page's "Last contacted" for a kid is the newest call they can see.
    expect(kid?.interactions[0].occurredAt).toEqual(called);
    expect(adult?.interactions.map((i) => i.type)).toEqual(["VISIT", "CALL"]);
  });
});
