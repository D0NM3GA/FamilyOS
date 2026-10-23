import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Past trips' "💳 Paid from" against a real database: `npm run test:db`. Only the money gate
 * (who's viewing, on their own sign-in) is faked.
 */
const RUN = import.meta.env.MODE === "db";
const state = { viewer: null as null | { id: string; householdId: string; firstName: string } };
vi.mock("./access", () => ({ moneyViewer: async () => state.viewer }));
const { tripCharges } = await import("./trip-links");

describe.skipIf(!RUN)("tripCharges (database)", () => {
  const ids = {} as { h: string; dad: string; mom: string; grandma: string; t1: string; t2: string; t3: string; family: string };

  beforeAll(async () => {
    const t = Date.now();
    const h = await prisma.household.create({ data: { name: `e2e trip links ${t}` } });
    const person = (firstName: string) => prisma.person.create({ data: { householdId: h.id, firstName, isHouseholdMember: true, role: "ADULT" } });
    const [dad, mom, grandma] = await Promise.all([person("Dad"), person("Mom"), person("Grandma")]);
    const family = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", emoji: "🏡", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const theirs = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's", members: { create: [{ personId: grandma.id }] } } });
    const trip = () => prisma.purchase.create({ data: { householdId: h.id, purchasedById: mom.id } });
    const [t1, t2, t3] = await Promise.all([trip(), trip(), trip()]);
    const acct = (jarId: string) => prisma.finAccount.create({ data: { jarId, source: "MANUAL", externalId: `a-${jarId}`, name: "Card" } });
    const [fa, ga] = await Promise.all([acct(family.id), acct(theirs.id)]);
    const charge = (jarId: string, accountId: string, purchaseId: string, extra: object = {}) =>
      prisma.finTransaction.create({
        data: { jarId, accountId, source: "MANUAL", externalId: `x-${purchaseId}-${jarId}`, postedOn: new Date("2026-10-03T00:00:00Z"), amountCents: -5000, description: "PUBLIX", merchantKey: "publix", purchaseId, ...extra },
      });
    await charge(family.id, fa.id, t1.id);
    // A surprise Dad marked, hidden from Mom until December.
    await charge(family.id, fa.id, t2.id, { giftById: dad.id, giftHiddenFrom: [mom.id], giftRevealOn: new Date("2099-12-25T00:00:00Z") });
    await charge(theirs.id, ga.id, t3.id);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, grandma: grandma.id, t1: t1.id, t2: t2.id, t3: t3.id, family: family.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const as = (id: string | null) => {
    state.viewer = id ? { id, householdId: ids.h, firstName: "x" } : null;
  };
  const trips = () => [ids.t1, ids.t2, ids.t3];

  test("only the viewer's own jars, never a surprise hidden from them, and nothing for anyone Money is closed to", async () => {
    as(ids.dad);
    const dad = await tripCharges(trips());
    expect([...dad.keys()].sort()).toEqual([ids.t1, ids.t2].sort());
    expect(dad.get(ids.t1)).toEqual({ jarId: ids.family, jarName: "Family", jarEmoji: "🏡", month: "2026-10" });

    as(ids.mom);
    expect([...(await tripCharges(trips())).keys()]).toEqual([ids.t1]);

    as(ids.grandma);
    expect([...(await tripCharges(trips())).keys()]).toEqual([ids.t3]);

    as(null);
    expect((await tripCharges(trips())).size).toBe(0);
  });
});
