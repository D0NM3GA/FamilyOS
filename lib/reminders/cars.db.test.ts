import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 62b against a real database (`npm run test:db`): car work due by its usual miles reminds,
 * a car's first recall check records quietly, a recall found later reminds once, one already
 * marked handled never does, and NHTSA is asked at most once a day per car.
 */
const RUN = import.meta.env.MODE === "db";
const listed = { recalls: [] as { campaignNumber: string; component: string; parkIt: boolean }[], calls: 0 };
vi.mock("@/lib/vehicles/nhtsa", async (orig) => {
  const real = await orig<typeof import("@/lib/vehicles/nhtsa")>();
  return {
    ...real,
    checkRecalls: async () => {
      listed.calls++;
      return { status: "ok", recalls: listed.recalls.map((r) => ({ ...r, reportReceivedDate: null, summary: "", consequence: "", remedy: "" })) };
    },
  };
});

describe.skipIf(!RUN)("car reminders (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", van: "" };
  const now = new Date();
  const day = 86_400_000;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-car-reminders-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const van = await prisma.vehicle.create({ data: { householdId: h.id, name: "van", year: 2020, make: "Example", model: "Wagon", currentMileage: 44_880, mileageUpdatedAt: now } });
    // 30 miles a day for a month; the oil change is 120 miles (about 4 days) away.
    await prisma.vehicleFuelLog.createMany({
      data: [
        { vehicleId: van.id, filledAt: new Date(now.getTime() - 30 * day), mileage: 43_980, gallons: 12 },
        { vehicleId: van.id, filledAt: new Date(now.getTime() - 15 * day), mileage: 44_430, gallons: 12 },
      ],
    });
    await prisma.vehicleMaintenanceItem.create({ data: { vehicleId: van.id, title: "Oil change", intervalMiles: 5000, lastDoneMileage: 40_000 } });
    Object.assign(ids, { h: h.id, dad: dad.id, van: van.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const titles = async () => (await prisma.notification.findMany({ where: { recipientId: ids.dad }, orderBy: { createdAt: "asc" }, select: { title: true } })).map((n) => n.title);

  test("work due by miles reminds; the first recall check is quiet; a new recall reminds once", async () => {
    const { remindHousehold } = await import("./run");
    listed.recalls = [{ campaignNumber: "26V001", component: "BRAKES", parkIt: false }];
    expect(await remindHousehold(ids.h, now)).toBe(1);
    expect(await titles()).toEqual(["Oil change on the van is due in about 4 days"]);
    expect(listed.calls).toBe(1);

    // Within the day: NHTSA isn't asked again.
    expect(await remindHousehold(ids.h, now)).toBe(0);
    expect(listed.calls).toBe(1);

    // A day later two more are listed; one was already marked handled.
    await prisma.vehicleRecallAck.create({ data: { vehicleId: ids.van, campaignNumber: "26V003" } });
    listed.recalls.push({ campaignNumber: "26V002", component: "AIR BAGS", parkIt: false }, { campaignNumber: "26V003", component: "WIPERS", parkIt: false });
    const later = new Date(now.getTime() + day + 60_000);
    expect(await remindHousehold(ids.h, later)).toBe(1);
    expect((await titles()).at(-1)).toBe("A safety recall for the van: air bags");
    expect(await prisma.vehicleRecallSeen.count({ where: { vehicleId: ids.van } })).toBe(3);
  });

  test("a recall found in someone's quiet hours reaches them after; a model fixed later starts quietly", async () => {
    const { remindHousehold } = await import("./run");
    const mom = await prisma.person.create({ data: { householdId: ids.h, firstName: "Mom", role: "ADULT", isHouseholdMember: true } });
    const at = new Date(now.getTime() + 2 * day + 120_000);
    const m = at.getHours() * 60 + at.getMinutes();
    await prisma.reminderPrefs.create({ data: { personId: mom.id, quietStart: (m + 1440 - 30) % 1440, quietEnd: (m + 30) % 1440 } });
    listed.recalls.push({ campaignNumber: "26V004", component: "STEERING", parkIt: false });
    await remindHousehold(ids.h, at);
    const momTitles = async () => (await prisma.notification.findMany({ where: { recipientId: mom.id }, select: { title: true } })).map((n) => n.title);
    expect(await momTitles()).not.toContain("A safety recall for the van: steering");
    // Her quiet hours over (the car isn't due another check): it comes now.
    await prisma.reminderPrefs.update({ where: { personId: mom.id }, data: { quietStart: null, quietEnd: null } });
    await remindHousehold(ids.h, new Date(at.getTime() + 60 * 60_000));
    expect(await momTitles()).toContain("A safety recall for the van: steering");

    // A car whose model NHTSA didn't know at first: its first good check is the baseline.
    const car = await prisma.vehicle.create({ data: { householdId: ids.h, name: "car", year: 2021, make: "Example", model: "Coupe", recallsCheckedAt: new Date(now.getTime() - 3 * day) } });
    listed.recalls = [{ campaignNumber: "26V900", component: "SEATS", parkIt: false }];
    await remindHousehold(ids.h, new Date(at.getTime() + 2 * 60 * 60_000));
    expect(await prisma.vehicleRecallSeen.findFirstOrThrow({ where: { vehicleId: car.id } })).toMatchObject({ baseline: true });
    expect(await titles()).not.toContain("A safety recall for the car: seats");
  });
});
