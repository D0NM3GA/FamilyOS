import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 65a against a real database (`npm run test:db`): taking an as-needed dose counts stock
 * down, keeps to the gap and the daily maximum, asks for a refill when a few doses are left, and
 * undoing removes it; as-needed doses stay off the board; the history is for grown-ups and the
 * medicine's own person.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("as-needed medicines (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", ivy: "", max: "", def: "", med: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-prn-${t}` } });
    const [dad, ivy, max] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Max", role: "KID", isHouseholdMember: true } }),
    ]);
    const def = await prisma.taskDefinition.create({
      data: {
        householdId: h.id,
        title: "Allergy syrup",
        domain: "MED",
        frequencyType: "AS_NEEDED",
        startDate: new Date(2026, 0, 1),
        points: 1,
        assignees: { connect: [{ id: ivy.id }] },
        medication: { create: { quantityOnHand: 8, doseAmount: 1, minGapHours: 4, maxPerDay: 3 } },
      },
      include: { medication: true },
    });
    Object.assign(ids, { h: h.id, dad: dad.id, ivy: ivy.id, max: max.id, def: def.id, med: def.medication!.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const as = async (id: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
  };
  const onHand = async () => (await prisma.medication.findUniqueOrThrow({ where: { id: ids.med } })).quantityOnHand;

  test("take, too soon, someone else's, undo", async () => {
    const { takeAsNeeded, undoAsNeeded } = await import("@/app/(app)/meds/actions");
    await as(ids.ivy);
    expect(await takeAsNeeded(ids.def)).toMatchObject({ ok: expect.stringMatching(/^Taken at /) });
    expect(await onHand()).toBe(7);
    expect(await takeAsNeeded(ids.def)).toEqual({ error: expect.stringMatching(/^Too soon\. Next from /) });
    expect(await onHand()).toBe(7);

    await as(ids.max);
    expect(await takeAsNeeded(ids.def)).toEqual({ error: "Only a grown-up can log someone else's medicine." });

    const dose = await prisma.taskInstance.findFirstOrThrow({ where: { definitionId: ids.def } });
    // The scheduled-dose undo would put it back to waiting: it refuses.
    const { uncompleteInstance } = await import("@/app/(app)/meds/actions");
    await as(ids.ivy);
    await expect(uncompleteInstance(dose.id)).rejects.toThrow("Use the as-needed actions");
    expect(dose).toMatchObject({ status: "DONE", assignedToId: ids.ivy, completedById: ids.ivy, quantityConsumed: 1 });
    expect(await prisma.pointsLedger.count({ where: { instanceId: dose.id, personId: ids.ivy } })).toBe(1);

    await as(ids.ivy);
    await undoAsNeeded(dose.id);
    expect(await prisma.taskInstance.count({ where: { definitionId: ids.def } })).toBe(0);
    expect(await onHand()).toBe(8);
  });

  test("the daily maximum; a refill item at a few doses left", async () => {
    const { takeAsNeeded } = await import("@/app/(app)/meds/actions");
    const hours = (n: number) => new Date(Date.now() - n * 3_600_000);
    // Three doses in the last 24 hours, the newest 5 hours ago: past the gap, at the maximum.
    for (const n of [20, 12, 5]) {
      await prisma.taskInstance.create({ data: { definitionId: ids.def, dueDate: hours(n), status: "DONE", completedAt: hours(n), completedById: ids.ivy, assignedToId: ids.ivy } });
    }
    await as(ids.dad);
    expect(await takeAsNeeded(ids.def)).toEqual({ error: expect.stringMatching(/^That's 3 in 24 hours\. Next from /) });
    await prisma.taskInstance.deleteMany({ where: { definitionId: ids.def, completedAt: { lt: hours(10) } } });

    await prisma.medication.update({ where: { id: ids.med }, data: { quantityOnHand: 6 } });
    expect(await takeAsNeeded(ids.def)).toMatchObject({ ok: expect.any(String) });
    expect(await onHand()).toBe(5);
    const refill = await prisma.shoppingListItem.findFirst({ where: { medicationId: ids.med } });
    expect(refill).not.toBeNull();
  });

  test("off the board; the history for grown-ups and the medicine's person only", async () => {
    const { getBoardInstances } = await import("@/lib/tasks/queries");
    const board = await getBoardInstances(ids.h, { domain: "MED", horizonDays: 0 });
    expect([...board.overdue, ...board.dueToday, ...board.upcoming]).toHaveLength(0);

    const { getAsNeeded } = await import("./as-needed-queries");
    const [row] = await getAsNeeded(ids.h);
    expect(row).toMatchObject({ definitionId: ids.def, canTakeNow: false, dosesLeft: "5 doses left", person: { firstName: "Ivy" } });
    expect(row.status).toMatch(/^Last taken .* \(Dad\) · next from /);

    const { doseHistory } = await import("./history");
    const viewer = async (id: string) => prisma.person.findUniqueOrThrow({ where: { id }, select: { id: true, householdId: true, role: true } });
    expect((await doseHistory(ids.def, await viewer(ids.dad)))?.taken).toBe(2);
    expect(await doseHistory(ids.def, await viewer(ids.ivy))).not.toBeNull();
    expect(await doseHistory(ids.def, await viewer(ids.max))).toBeNull();
  });
});
