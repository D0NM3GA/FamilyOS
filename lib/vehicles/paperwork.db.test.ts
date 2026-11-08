import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 65b against a real database (`npm run test:db`): paperwork renews from its old due day
 * and undo moves it back; a repair lands on the car's hidden Repairs item, counts in the history
 * and costs, moves the odometer, and can be deleted; the Repairs item is never listed or due, and
 * paperwork reminds two weeks ahead, once.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});
vi.mock("@/lib/vehicles/nhtsa", async (orig) => {
  const real = await orig<typeof import("@/lib/vehicles/nhtsa")>();
  return { ...real, checkRecalls: async () => ({ status: "ok", recalls: [] }) };
});

describe.skipIf(!RUN)("car paperwork and repairs (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", van: "", paper: "" };
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-paperwork-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const van = await prisma.vehicle.create({ data: { householdId: h.id, name: "van", currentMileage: 40_000 } });
    Object.assign(ids, { h: h.id, dad: dad.id, van: van.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: dad.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.append(k, v);
    return f;
  };

  test("add paperwork, renew from the old due day, undo moves it back", async () => {
    const { createMaintenanceItem, logMaintenanceDone, undoLastService } = await import("@/app/(app)/vehicles/actions");
    const due = new Date();
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + 10);
    await expect(createMaintenanceItem(ids.van, {}, form({ kind: "PAPERWORK", title: "Registration", intervalMonths: "12", nextDueAt: iso(due) }))).rejects.toThrow("REDIRECT");
    const paper = await prisma.vehicleMaintenanceItem.findFirstOrThrow({ where: { vehicleId: ids.van, kind: "PAPERWORK" } });
    expect(paper).toMatchObject({ title: "Registration", intervalMonths: 12, intervalMiles: null });
    expect(iso(paper.nextDueAt!)).toBe(iso(due));
    ids.paper = paper.id;

    // Two weeks ahead: one reminder, then not again.
    const { remindHousehold } = await import("@/lib/reminders/run");
    await remindHousehold(ids.h, new Date());
    await remindHousehold(ids.h, new Date());
    const titles = (await prisma.notification.findMany({ where: { recipientId: ids.dad }, select: { title: true } })).map((n) => n.title);
    expect(titles).toEqual(["Registration on the van is due in 10 days"]);

    expect(await logMaintenanceDone(paper.id, {}, form({ cost: "85.00" }))).toEqual({});
    const renewed = await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: paper.id } });
    const nextYear = new Date(due);
    nextYear.setFullYear(due.getFullYear() + 1);
    expect(iso(renewed.nextDueAt!)).toBe(iso(nextYear));

    await undoLastService(paper.id);
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: paper.id } })).nextDueAt!)).toBe(iso(due));

    // Phase 69b: Good until wins (a six-month term), Undo still moves it back, and it must be after the renewal.
    const sixMonths = new Date(due);
    sixMonths.setMonth(due.getMonth() + 6);
    expect(await logMaintenanceDone(paper.id, {}, form({ goodUntil: iso(sixMonths) }))).toEqual({});
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: paper.id } })).nextDueAt!)).toBe(iso(sixMonths));
    await undoLastService(paper.id);
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: paper.id } })).nextDueAt!)).toBe(iso(due));
    expect(await logMaintenanceDone(paper.id, {}, form({ goodUntil: "2020-01-01" }))).toEqual({ error: "Good until should be after the day it was renewed." });

    // A catch-up entry for an older renewal leaves the due day alone.
    expect(await logMaintenanceDone(paper.id, {}, form({ goodUntil: iso(sixMonths) }))).toEqual({});
    const lastMonth = new Date(due);
    lastMonth.setDate(1);
    lastMonth.setMonth(lastMonth.getMonth() - 2);
    expect(await logMaintenanceDone(paper.id, {}, form({ doneAt: iso(lastMonth), goodUntil: iso(nextYear) }))).toEqual({});
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: paper.id } })).nextDueAt!)).toBe(iso(sixMonths));
  });

  test("Good until on paperwork with no due day; undo empties it again (Phase 69b)", async () => {
    const { logMaintenanceDone, undoLastService } = await import("@/app/(app)/vehicles/actions");
    const bare = await prisma.vehicleMaintenanceItem.create({ data: { vehicleId: ids.van, kind: "PAPERWORK", title: "Parking permit" } });
    const until = new Date();
    until.setHours(0, 0, 0, 0);
    until.setMonth(until.getMonth() + 3);
    expect(await logMaintenanceDone(bare.id, {}, form({ goodUntil: iso(until) }))).toEqual({});
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: bare.id } })).nextDueAt!)).toBe(iso(until));
    await undoLastService(bare.id);
    expect((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: bare.id } })).nextDueAt).toBeNull();
    await prisma.vehicleMaintenanceItem.delete({ where: { id: bare.id } });
  });

  test("a month-end renewal undoes to the same day (Jan 31, monthly)", async () => {
    const { logMaintenanceDone, undoLastService } = await import("@/app/(app)/vehicles/actions");
    const monthly = await prisma.vehicleMaintenanceItem.create({ data: { vehicleId: ids.van, kind: "PAPERWORK", title: "Insurance", intervalMonths: 1, nextDueAt: new Date(2027, 0, 31) } });
    expect(await logMaintenanceDone(monthly.id, {}, form({}))).toEqual({});
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: monthly.id } })).nextDueAt!)).toBe("2027-02-28");
    await undoLastService(monthly.id);
    expect(iso((await prisma.vehicleMaintenanceItem.findUniqueOrThrow({ where: { id: monthly.id } })).nextDueAt!)).toBe("2027-01-31");
    await prisma.vehicleMaintenanceItem.delete({ where: { id: monthly.id } });
  });

  test("a repair: on the hidden Repairs item, in history and costs, moves the odometer, deletes", async () => {
    const { logRepair, deleteRepair, logMaintenanceDone } = await import("@/app/(app)/vehicles/actions");
    expect(await logRepair(ids.van, {}, form({ title: "New battery", cost: "150", mileage: "40500" }))).toEqual({ notice: "Repair logged ✓" });
    expect(await logRepair(ids.van, {}, form({ title: "", cost: "1" }))).toEqual({ error: "Say what was fixed" });
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: ids.van } })).currentMileage).toBe(40_500);
    expect(await prisma.vehicleMaintenanceItem.count({ where: { vehicleId: ids.van, kind: "REPAIRS" } })).toBe(1);

    const { getVehicleDetail, getVehiclesWithStatus } = await import("@/lib/vehicles/queries");
    const detail = (await getVehicleDetail(ids.h, ids.van))!;
    expect(detail.items.map((i) => i.item.kind)).toEqual(["PAPERWORK"]);
    const repair = detail.serviceLogs.find((l) => l.item.kind === "REPAIRS")!;
    expect(repair).toMatchObject({ costCents: 15000, item: { title: "New battery" } });
    const [board] = await getVehiclesWithStatus(ids.h);
    expect(board.items.some((i) => i.item.kind === "REPAIRS")).toBe(false);

    // Repairs can't be "serviced", and deleting only takes repairs.
    expect(await logMaintenanceDone(repair.itemId, {}, form({}))).toEqual({ error: "Maintenance item not found." });
    await deleteRepair(repair.id);
    expect(await prisma.vehicleServiceLog.count({ where: { id: repair.id } })).toBe(0);
  });
});
