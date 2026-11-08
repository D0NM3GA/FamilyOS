import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { atMidnight } from "@/lib/tasks/schedule";

/**
 * Phase 66a against a real database (`npm run test:db`): medicine stock stops at zero and rounds,
 * a dose records what it really took so Undo gives that back, and taking a dose asks for a refill
 * on the running-low reminder's rule (a week of supply), not only at the refill count.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("medicine stock (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-stock-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    Object.assign(ids, { h: h.id, dad: dad.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: dad.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  /** A daily medicine with one dose due today. */
  async function medicine(title: string, med: { quantityOnHand: number | null; doseAmount: number | null; refillThresholdQuantity?: number | null }) {
    const def = await prisma.taskDefinition.create({
      data: {
        householdId: ids.h,
        title,
        domain: "MED",
        frequencyType: "DAILY",
        startDate: new Date(2026, 0, 1),
        assignees: { connect: [{ id: ids.dad }] },
        medication: { create: med },
      },
      include: { medication: true },
    });
    const dose = await prisma.taskInstance.create({ data: { definitionId: def.id, dueDate: atMidnight(new Date()), assignedToId: ids.dad } });
    return { def, med: def.medication!, dose };
  }
  const onHand = async (id: string) => (await prisma.medication.findUniqueOrThrow({ where: { id } })).quantityOnHand;

  test("a dose from a nearly empty bottle stops at zero, and Undo gives back what it took", async () => {
    const { completeInstance, uncompleteInstance } = await import("@/app/(app)/meds/actions");
    const { med, dose } = await medicine(`Nearly empty ${t}`, { quantityOnHand: 0.5, doseAmount: 1 });
    await completeInstance(dose.id);
    expect(await onHand(med.id)).toBe(0);
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: dose.id } })).quantityConsumed).toBe(0.5);
    await uncompleteInstance(dose.id);
    expect(await onHand(med.id)).toBe(0.5);
  });

  test("fractional doses and restocks don't drift", async () => {
    const { completeInstance, addStock } = await import("@/app/(app)/meds/actions");
    const { def, med, dose } = await medicine(`Drops ${t}`, { quantityOnHand: 1, doseAmount: 0.1 });
    await completeInstance(dose.id);
    expect(await onHand(med.id)).toBe(0.9);
    for (const amount of ["0.1", "0.2"]) {
      const fd = new FormData();
      fd.set("amount", amount);
      await addStock(def.id, fd);
    }
    expect(await onHand(med.id)).toBe(1.2);
  });

  test("an uncounted medicine stays uncounted", async () => {
    const { completeInstance } = await import("@/app/(app)/meds/actions");
    const { med, dose } = await medicine(`Uncounted ${t}`, { quantityOnHand: null, doseAmount: 1 });
    await completeInstance(dose.id);
    expect(await onHand(med.id)).toBeNull();
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: dose.id } })).quantityConsumed).toBeNull();
  });

  test("a week of supply left puts the refill on the list, with no refill count set", async () => {
    const { completeInstance } = await import("@/app/(app)/meds/actions");
    const title = `Weekly refill ${t}`;
    const { dose } = await medicine(title, { quantityOnHand: 8, doseAmount: 1, refillThresholdQuantity: null });
    await completeInstance(dose.id);
    const item = await prisma.shoppingListItem.findFirst({ where: { list: { householdId: ids.h }, product: { name: title } } });
    expect(item).not.toBeNull();
  });
});

describe.skipIf(!RUN)("editing a chore (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", ivy: "", max: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-chore-edit-${t}` } });
    const [dad, ivy, max] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Max", role: "KID", isHouseholdMember: true } }),
    ]);
    Object.assign(ids, { h: h.id, dad: dad.id, ivy: ivy.id, max: max.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: dad.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
    return fd;
  };
  const start = new Date(2026, 0, 1);
  const startText = `${start.getFullYear()}-01-01`;

  test("a new day or person drops the planned days (not moved ones); a title edit keeps them", async () => {
    const { updateTaskDefinition } = await import("@/app/(app)/chores/actions");
    const def = await prisma.taskDefinition.create({
      data: { householdId: ids.h, title: "Trash", domain: "CHORE", frequencyType: "DAILY", startDate: start, assignmentStrategy: "FIXED", assignees: { connect: [{ id: ids.ivy }] } },
    });
    const today = atMidnight(new Date());
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const later = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
    const [planned, moved] = await Promise.all([
      prisma.taskInstance.create({ data: { definitionId: def.id, dueDate: tomorrow, assignedToId: ids.ivy } }),
      prisma.taskInstance.create({ data: { definitionId: def.id, dueDate: later, assignedToId: ids.ivy, movedFrom: today } }),
    ]);
    const fields = { title: "Take out the trash", frequencyType: "DAILY", startDate: startText, points: "0", assignmentStrategy: "FIXED", assigneeIds: [ids.ivy] };

    // Only the title: the planned day stays (redirect throws in a test, as in the app).
    await updateTaskDefinition(def.id, {}, form(fields)).catch(() => {});
    expect(await prisma.taskInstance.count({ where: { id: planned.id } })).toBe(1);

    // A different person: the planned day goes, the moved one stays.
    await updateTaskDefinition(def.id, {}, form({ ...fields, assigneeIds: [ids.max] })).catch(() => {});
    expect(await prisma.taskInstance.count({ where: { id: planned.id } })).toBe(0);
    expect(await prisma.taskInstance.count({ where: { id: moved.id } })).toBe(1);
  });
});
