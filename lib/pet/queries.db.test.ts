import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { feedMeal } from "./care";
import { GIFTS_PER_DAY } from "./gifts";
import { changeMyPet, finishMyGame, getMyPet, hatchEgg, openMyPresent, placeMyItem } from "./queries";
import { newEgg, STAGE_MINUTES } from "./state";

/**
 * Phase 47 against a real database: `npm run test:db`. A throwaway household with a kid whose
 * pet is awake all day, so the clock never gets in the way. Checks the things only the
 * database can: one pet per person, each person reaches only their own pet, the chore
 * presents' once-only and no-takebacks rules, the memory book, and that nothing a pet does
 * touches points.
 */
const RUN = import.meta.env.MODE === "db";
const ALL_DAY = { weekday: [{ start: 0, end: 1440 }], weekend: [{ start: 0, end: 1440 }] };
const MINUTE = 60_000;

describe.skipIf(!RUN)("the pet (database)", () => {
  const h = { id: "" };
  const who = {} as { ivy: { id: string; householdId: string }; max: { id: string; householdId: string } };
  let choreId = "";
  let day = 0;

  const ledgerRows = () => prisma.pointsLedger.count({ where: { personId: { in: [who.ivy.id, who.max.id] } } });

  /**
   * A baby pet, caught up to just now: no clock time passes before a test, so nothing random
   * (poop, sickness) can happen, and chores done "now" are after its birth.
   */
  async function freshPet(personId: string) {
    await prisma.pet.deleteMany({ where: { personId } });
    const bornAt = new Date(Date.now() - 1000);
    await prisma.pet.create({
      data: {
        householdId: h.id,
        personId,
        name: "Pip",
        seed: `seed-${personId}`,
        state: { ...newEgg("blob", Math.floor(bornAt.getTime() / MINUTE)), stage: "baby" },
        bornAt,
        lastAdvancedAt: bornAt,
      },
    });
  }

  /** A chore instance finished by someone, on its own due day. */
  async function doneChore(assignedToId: string | null, completedById: string) {
    day += 1;
    return prisma.taskInstance.create({
      data: {
        definitionId: choreId,
        dueDate: new Date(Date.UTC(2026, 0, day)),
        assignedToId,
        status: "DONE",
        completedAt: new Date(),
        completedById,
      },
    });
  }

  beforeAll(async () => {
    const house = await prisma.household.create({ data: { name: `pet-${Date.now()}`, timezone: "UTC", petCareHours: ALL_DAY } });
    h.id = house.id;
    const kid = async (firstName: string) => {
      const p = await prisma.person.create({ data: { householdId: house.id, firstName, role: "KID", isHouseholdMember: true } });
      return { id: p.id, householdId: house.id };
    };
    who.ivy = await kid("Ivy");
    who.max = await kid("Max");
    const chore = await prisma.taskDefinition.create({
      data: { householdId: house.id, title: "Make the bed", frequencyType: "DAILY", startDate: new Date(Date.UTC(2026, 0, 1)), points: 2 },
    });
    choreId = chore.id;
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: h.id } });
  });

  beforeEach(async () => {
    await prisma.petGift.deleteMany({ where: { householdId: h.id } });
    await prisma.taskInstance.deleteMany({ where: { definitionId: choreId } });
    await prisma.petItem.deleteMany({ where: { householdId: h.id } });
  });

  test("one pet per person", async () => {
    await prisma.pet.deleteMany({ where: { personId: who.ivy.id } });
    expect(await hatchEgg(who.ivy, "bird", "Pip")).toBe(true);
    expect(await hatchEgg(who.ivy, "blob", "Again")).toBe(false);
    expect(await prisma.pet.count({ where: { personId: who.ivy.id } })).toBe(1);
  });

  test("an egg hatches on time and its first toys arrive", async () => {
    await prisma.pet.deleteMany({ where: { personId: who.ivy.id } });
    const start = new Date();
    await hatchEgg(who.ivy, "critter", "Pip", start);
    const later = new Date(start.getTime() + (STAGE_MINUTES.egg + 1) * MINUTE);
    const mine = await getMyPet(who.ivy, later);
    expect(mine.pet?.state.stage).toBe("baby");
    expect(mine.items.map((item) => item.itemId).sort()).toEqual(["ball", "plant"]);
  });

  test("care reaches only your own pet, and never touches points", async () => {
    await freshPet(who.ivy.id);
    await freshPet(who.max.id);
    const before = await ledgerRows();
    const maxBefore = await prisma.pet.findUnique({ where: { personId: who.max.id } });
    const result = await changeMyPet(who.ivy, (state) => feedMeal({ ...state, hunger: 10 }));
    expect(result.ok).toBe(true);
    expect((await prisma.pet.findUnique({ where: { personId: who.max.id } }))?.lastAdvancedAt).toEqual(maxBefore?.lastAdvancedAt);
    await finishMyGame(who.ivy, "fetch", 300);
    expect(await ledgerRows()).toBe(before);
  });

  test("a mini-game pays out once an hour, however big the score", async () => {
    await freshPet(who.ivy.id);
    await prisma.petPlay.deleteMany({ where: { personId: who.ivy.id } });
    const first = await finishMyGame(who.ivy, "copy-dance", 1e9);
    expect(first).toMatchObject({ ok: true, result: { outcome: "ok" } });
    expect(await finishMyGame(who.ivy, "copy-dance", 8)).toMatchObject({ ok: false, reason: "played-recently" });
    expect(await finishMyGame(who.ivy, "copy-dance", 8, new Date(Date.now() + 61 * MINUTE))).toMatchObject({ ok: true });
  });

  test("you can only move your own things", async () => {
    await freshPet(who.max.id);
    await getMyPet(who.max);
    const maxBall = await prisma.petItem.findFirstOrThrow({ where: { personId: who.max.id, itemId: "ball" } });
    expect(await placeMyItem(who.ivy, maxBall.id, "out")).toBe(false);
    expect(await placeMyItem(who.max, maxBall.id, "out")).toBe(true);
    expect(await placeMyItem(who.max, maxBall.id, "wall")).toBe(false);
  });

  test("a finished chore brings a present, once", async () => {
    await freshPet(who.ivy.id);
    const chore = await doneChore(who.ivy.id, who.ivy.id);
    const first = await getMyPet(who.ivy);
    expect(first.presents).toHaveLength(1);
    expect((await getMyPet(who.ivy)).presents).toHaveLength(1);
    expect(await prisma.petGift.count({ where: { instanceId: chore.id } })).toBe(1);
  });

  test("undoing a chore keeps its present, and redoing it brings no second one", async () => {
    await freshPet(who.ivy.id);
    const chore = await doneChore(who.ivy.id, who.ivy.id);
    await getMyPet(who.ivy);
    await prisma.taskInstance.update({ where: { id: chore.id }, data: { status: "PENDING", completedAt: null, completedById: null } });
    expect((await getMyPet(who.ivy)).presents).toHaveLength(1);
    await prisma.taskInstance.update({ where: { id: chore.id }, data: { status: "DONE", completedAt: new Date(), completedById: who.ivy.id } });
    expect((await getMyPet(who.ivy)).presents).toHaveLength(1);
    expect(await prisma.petGift.count({ where: { personId: who.ivy.id } })).toBe(1);
  });

  test("a present goes to whoever the chore was for, not someone else", async () => {
    await freshPet(who.ivy.id);
    await freshPet(who.max.id);
    await doneChore(who.max.id, who.ivy.id);
    await doneChore(null, who.ivy.id);
    expect((await getMyPet(who.ivy)).presents).toHaveLength(1);
    expect((await getMyPet(who.max)).presents).toHaveLength(1);
  });

  test("presents stop at the day's cap", async () => {
    await freshPet(who.ivy.id);
    for (let i = 0; i < GIFTS_PER_DAY + 2; i++) await doneChore(who.ivy.id, who.ivy.id);
    expect((await getMyPet(who.ivy)).presents).toHaveLength(GIFTS_PER_DAY);
    expect(await prisma.petGift.count({ where: { personId: who.ivy.id, itemId: null } })).toBe(2);
  });

  test("chores done before the pet hatched bring nothing", async () => {
    await doneChore(who.ivy.id, who.ivy.id);
    await freshPet(who.ivy.id);
    await prisma.pet.update({ where: { personId: who.ivy.id }, data: { bornAt: new Date(Date.now() + MINUTE) } });
    expect((await getMyPet(who.ivy)).presents).toHaveLength(0);
  });

  test("opening a present adds to the pet and never touches points", async () => {
    await freshPet(who.ivy.id);
    await doneChore(who.ivy.id, who.ivy.id);
    const before = await ledgerRows();
    const [present] = (await getMyPet(who.ivy)).presents;
    expect(await openMyPresent(who.max, present)).toMatchObject({ ok: false, reason: "no-present" });
    const opened = await openMyPresent(who.ivy, present);
    expect(opened.ok).toBe(true);
    expect(await openMyPresent(who.ivy, present)).toMatchObject({ ok: false });
    expect((await getMyPet(who.ivy)).presents).toHaveLength(0);
    expect(await ledgerRows()).toBe(before);
  });

  test("a pet that's gone moves to the memory book", async () => {
    await freshPet(who.ivy.id);
    const pet = await prisma.pet.findUniqueOrThrow({ where: { personId: who.ivy.id } });
    const state = pet.state as Record<string, unknown>;
    await prisma.pet.update({
      where: { id: pet.id },
      // Two minutes behind, so catching up plays the minute that ends it.
      data: { state: { ...state, sick: true, dosesNeeded: 1, sickMinutes: 239 }, lastAdvancedAt: new Date(Date.now() - 2 * MINUTE) },
    });
    const mine = await getMyPet(who.ivy);
    expect(mine.pet).toBeNull();
    expect(mine.goodbye).toMatchObject({ name: "Pip", cause: "sickness", stage: "baby" });
    expect(await prisma.petMemorial.count({ where: { personId: who.ivy.id } })).toBe(1);
    expect(await prisma.pet.count({ where: { personId: who.ivy.id } })).toBe(0);
  });
});
