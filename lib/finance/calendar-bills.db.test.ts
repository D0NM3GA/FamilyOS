import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/tasks/schedule";

/**
 * Phase 63b against a real database (`npm run test:db`): the calendar's bills are names and days
 * for the viewer's own jars only, a found bill a hand-added one stands for shows once, and a
 * grown-up who isn't a member (or a kid) sees none.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown>, own: true };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => who.own };
});

describe.skipIf(!RUN)("calendar bills (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", jar: "" };
  const users: string[] = [];
  const civil = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-cal-bills-${t}` } });
    const person = async (firstName: string, role: "ADMIN" | "ADULT" | "KID") => {
      const user = await prisma.user.create({ data: { id: `e2e-cb-${firstName}-${t}`, name: firstName } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom, ivy] = await Promise.all([person("Dad", "ADMIN"), person("Mom", "ADULT"), person("Ivy", "KID")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: `a-${t}`, name: "Checking" } });
    // A water bill each month for four months: found as a regular bill.
    const today = new Date();
    for (let m = 4; m >= 1; m--) {
      const on = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 5));
      await prisma.finTransaction.create({
        data: { jarId: jar.id, accountId: account.id, source: "MANUAL", externalId: `w-${m}-${t}`, postedOn: on, amountCents: -5000, description: "CITY WATER", merchantKey: "city water" },
      });
    }
    await prisma.manualBill.create({ data: { jarId: jar.id, name: "Swim club", amountCents: 9000, cadence: "MONTHLY", nextDue: addDays(new Date(civil(today) + "T00:00:00Z"), 3) } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, jar: jar.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (id: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
  };

  test("a member sees names and days only; others see none", async () => {
    const { billDays } = await import("./calendar-bills");
    const from = civil(new Date());
    const until = civil(new Date(Date.now() + 40 * 86_400_000));
    await as(ids.dad);
    const days = await billDays(from, until);
    expect(days.map((d) => d.name)).toEqual(expect.arrayContaining(["Swim club"]));
    expect(days.some((d) => /water/i.test(d.name))).toBe(true);
    for (const d of days) expect(Object.keys(d).sort()).toEqual(["day", "name"]);

    // Dad's profile opened with a PIN on someone else's sign-in: nothing.
    who.own = false;
    expect(await billDays(from, until)).toEqual([]);
    who.own = true;

    await as(ids.mom);
    expect(await billDays(from, until)).toEqual([]);
    await as(ids.ivy);
    expect(await billDays(from, until)).toEqual([]);
  });
});
