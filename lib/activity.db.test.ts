import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getHouseholdActivity } from "./activity";
import { getPersonWithDetails } from "./people";

/** Home's activity feed against a real database: `npm run test:db`. */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("activity feed and grown-ups-only calls (database)", () => {
  let h = "";
  let grandmaId = "";
  const called = new Date(Date.now() - 2 * 86_400_000);

  beforeAll(async () => {
    h = (await prisma.household.create({ data: { name: `e2e activity ${Date.now()}` } })).id;
    const grandma = await prisma.person.create({ data: { householdId: h, firstName: "Grandma" } });
    grandmaId = grandma.id;
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
    const kid = await getHouseholdActivity(h, 10, { viewerIsAdult: false });
    const adult = await getHouseholdActivity(h, 10, { viewerIsAdult: true });
    expect(kid.map((e) => e.text)).toEqual(["Someone logged a call with Grandma"]);
    expect(adult.map((e) => e.text).sort()).toEqual(["Someone logged a call with Grandma", "Someone logged a visit with Grandma"]);
    // No viewer given: treated as a kid, the safe default.
    expect(await getHouseholdActivity(h, 10)).toHaveLength(1);
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
