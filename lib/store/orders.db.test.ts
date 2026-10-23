import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { actOnOrder, placeOrder } from "./orders";

/**
 * Phase 20 Sticker Store orders against a real database: `npm run test:db`. Skipped by
 * plain `npm test`. Throwaway households, deleted afterwards (which also proves a household
 * with orders can be deleted — the reward FK must not block the cascade).
 */
const RUN = import.meta.env.MODE === "db";

type P = { id: string; householdId: string; firstName: string; role: "ADULT" | "KID" | "ADMIN" | null };

describe.skipIf(!RUN)("sticker store orders (database)", () => {
  const h = { id: "", other: "" };
  const who = {} as { mom: P; dad: P; grandma: P; kid: P; kid2: P; stranger: P };
  const reward = {} as { treat: string; skip: string; big: string; foreign: string };

  const balance = async (personId: string) =>
    (await prisma.pointsLedger.aggregate({ where: { personId }, _sum: { delta: true } }))._sum.delta ?? 0;
  const earn = (personId: string, delta: number) => prisma.pointsLedger.create({ data: { personId, delta, reason: "test earn" } });

  beforeAll(async () => {
    const tag = `e2e-store-${Date.now()}`;
    const house = await prisma.household.create({ data: { name: tag } });
    const other = await prisma.household.create({ data: { name: `${tag}-other` } });
    h.id = house.id;
    h.other = other.id;
    const person = async (firstName: string, role: P["role"], householdId = house.id): Promise<P> => {
      const p = await prisma.person.create({ data: { householdId, firstName, role, isHouseholdMember: true } });
      return { id: p.id, householdId, firstName, role };
    };
    who.mom = await person("Mom", "ADMIN");
    who.dad = await person("Dad", "ADMIN");
    who.grandma = await person("Grandma", "ADULT");
    who.kid = await person("Ivy", "KID");
    who.kid2 = await person("Rowan", "KID");
    who.stranger = await person("Stranger", "KID", other.id);
    const mk = (title: string, pointCost: number, extra: object = {}, householdId = house.id) =>
      prisma.reward.create({ data: { householdId, title, pointCost, ...extra } }).then((r) => r.id);
    reward.treat = await mk("Pick dessert", 15);
    reward.skip = await mk("Skip a chore", 40, { limitPerWeek: 1 });
    reward.big = await mk("Trampoline park", 50, { needsApproval: true });
    reward.foreign = await mk("Their treat", 1, {}, other.id);
    await earn(who.kid.id, 200);
    await earn(who.kid2.id, 10);
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [h.id, h.other] } } });
  });

  test("a purchase takes the stickers and pings both admins, not the buyer", async () => {
    const before = await balance(who.kid.id);
    const res = await placeOrder(who.kid, reward.treat);
    expect(res).toMatchObject({ status: "TO_DO" });
    expect(await balance(who.kid.id)).toBe(before - 15);
    const orderId = (res as { orderId: string }).orderId;
    const pings = await prisma.notification.findMany({ where: { orderId } });
    expect(pings.map((n) => n.recipientId).sort()).toEqual([who.mom.id, who.dad.id].sort());
    expect(pings[0].kind).toBe("ORDER_PLACED");
  });

  test("an admin buying pings only the other admin", async () => {
    await earn(who.mom.id, 20);
    const res = await placeOrder(who.mom, reward.treat);
    const pings = await prisma.notification.findMany({ where: { orderId: (res as { orderId: string }).orderId } });
    expect(pings.map((n) => n.recipientId)).toEqual([who.dad.id]);
  });

  test("not enough stickers is refused and nothing moves", async () => {
    const before = await balance(who.kid2.id);
    expect(await placeOrder(who.kid2, reward.treat)).toMatchObject({ error: expect.stringContaining("10 stickers") });
    expect(await balance(who.kid2.id)).toBe(before);
  });

  test("kids can't spend someone else's stickers; grown-ups can buy for anyone in the family", async () => {
    expect(await placeOrder(who.kid2, reward.treat, who.kid.id)).toMatchObject({ error: expect.any(String) });
    const before = await balance(who.kid.id);
    const res = await placeOrder(who.grandma, reward.big, who.kid.id);
    // A grown-up placing it is the OK, even for a needs-OK reward.
    expect(res).toMatchObject({ status: "TO_DO" });
    expect(await balance(who.kid.id)).toBe(before - 50);
    expect(await placeOrder(who.grandma, reward.treat, who.stranger.id)).toMatchObject({ error: "Person not found." });
    expect(await placeOrder(who.kid, reward.foreign)).toMatchObject({ error: expect.any(String) });
  });

  test("the week limit counts live orders but not refunded ones", async () => {
    const first = await placeOrder(who.kid, reward.skip);
    expect(first).toMatchObject({ status: "TO_DO" });
    expect(await placeOrder(who.kid, reward.skip)).toMatchObject({ error: expect.stringContaining("1 a week") });
    await actOnOrder(who.mom, (first as { orderId: string }).orderId, "refund");
    expect(await placeOrder(who.kid, reward.skip)).toMatchObject({ status: "TO_DO" });
  });

  test("two buys at once can't both pass the limit", async () => {
    await earn(who.kid2.id, 200);
    const results = await Promise.all([placeOrder(who.kid2, reward.skip), placeOrder(who.kid2, reward.skip)]);
    expect(results.filter((r) => "orderId" in r)).toHaveLength(1);
  });

  test("needs-OK: stickers are held, a no gives them back, a yes keeps them", async () => {
    const before = await balance(who.kid.id);
    const asked = (await placeOrder(who.kid, reward.big)) as { orderId: string; status: string };
    expect(asked.status).toBe("WAITING_OK");
    expect(await balance(who.kid.id)).toBe(before - 50);
    const ping = await prisma.notification.findFirstOrThrow({ where: { orderId: asked.orderId } });
    expect(ping.kind).toBe("ORDER_NEEDS_OK");

    expect(await actOnOrder(who.dad, asked.orderId, "decline", "Maybe next month")).toEqual({});
    expect(await balance(who.kid.id)).toBe(before);
    const declined = await prisma.rewardOrder.findUniqueOrThrow({ where: { id: asked.orderId } });
    expect(declined).toMatchObject({ status: "DECLINED", note: "Maybe next month", decidedById: who.dad.id });
    // The kid hears about it in their bell (and grown-ups' Teams/email never fire for it).
    const told = await prisma.notification.findFirstOrThrow({ where: { recipientId: who.kid.id, kind: "ORDER_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(told.title).toMatch(/^Not this time for .+ stickers are back\.$/);

    const again = (await placeOrder(who.kid, reward.big)) as { orderId: string };
    expect(await actOnOrder(who.mom, again.orderId, "approve")).toEqual({});
    expect(await balance(who.kid.id)).toBe(before - 50);
    expect(await actOnOrder(who.mom, again.orderId, "deliver")).toEqual({});
    expect((await prisma.rewardOrder.findUniqueOrThrow({ where: { id: again.orderId } })).status).toBe("DELIVERED");
  });

  test("approve vs decline, and refund twice: exactly one wins, stickers move once", async () => {
    await earn(who.kid.id, 200);
    const before = await balance(who.kid.id);
    const asked = (await placeOrder(who.kid, reward.big)) as { orderId: string };
    expect(asked.orderId).toBeTruthy();
    const raced = await Promise.all([actOnOrder(who.mom, asked.orderId, "approve"), actOnOrder(who.dad, asked.orderId, "decline")]);
    expect(raced.filter((r) => !("error" in r))).toHaveLength(1);

    const bought = (await placeOrder(who.kid, reward.treat)) as { orderId: string };
    const mid = await balance(who.kid.id);
    const refunds = await Promise.all([actOnOrder(who.mom, bought.orderId, "refund"), actOnOrder(who.dad, bought.orderId, "refund")]);
    expect(refunds.filter((r) => "error" in r)).toHaveLength(1);
    expect(await balance(who.kid.id)).toBe(mid + 15);
    // Whatever the race decided for the needs-OK order, the books balance.
    const status = (await prisma.rewardOrder.findUniqueOrThrow({ where: { id: asked.orderId } })).status;
    expect(await balance(who.kid.id)).toBe(before - (status === "TO_DO" ? 50 : 0));
  });

  test("a delivered order can't be refunded, and kids can't act on orders", async () => {
    const o = (await placeOrder(who.kid, reward.treat)) as { orderId: string };
    expect(await actOnOrder(who.kid, o.orderId, "deliver")).toMatchObject({ error: expect.any(String) });
    await actOnOrder(who.mom, o.orderId, "deliver");
    expect(await actOnOrder(who.mom, o.orderId, "refund")).toMatchObject({ error: expect.stringContaining("already") });
  });

  test("grown-ups from another household can't touch these orders", async () => {
    const o = (await placeOrder(who.kid, reward.treat)) as { orderId: string };
    const outsider = { ...who.mom, householdId: h.other };
    expect(await actOnOrder(outsider, o.orderId, "refund")).toMatchObject({ error: expect.any(String) });
  });
});
