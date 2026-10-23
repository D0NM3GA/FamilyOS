import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Against a real database: `npm run test:db`. Cars is grown-ups only (lib/app-guard.ts), so a
 * kid can't log a fill-up at all (Phase 12 once let them, without a cost); an adult's keeps its cost.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("fill-ups and kids (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", kid: "", mom: "", van: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-fuel-${Date.now()}` } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true } });
    const van = await prisma.vehicle.create({ data: { householdId: h.id, name: "Van", currentMileage: 1000 } });
    Object.assign(ids, { h: h.id, kid: kid.id, mom: mom.id, van: van.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const fill = async (personId: string, mileage: string) => {
    const { logFuel } = await import("@/app/(app)/vehicles/actions");
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
    const f = new FormData();
    for (const [k, v] of [["mileage", mileage], ["gallons", "10"], ["cost", "$42.10"], ["fullTank", "1"]]) f.append(k, v);
    return logFuel(ids.van, {}, f);
  };

  test("a kid can't log a fill-up; an adult's keeps its cost", async () => {
    await expect(fill(ids.kid, "1100")).rejects.toThrow("Only adults can do that");
    expect((await fill(ids.mom, "1200")).error).toBeUndefined();
    const logs = await prisma.vehicleFuelLog.findMany({ where: { vehicleId: ids.van }, select: { mileage: true, costCents: true } });
    expect(logs).toEqual([{ mileage: 1200, costCents: 4210 }]);
  });
});
