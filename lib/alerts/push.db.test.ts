import { createECDH } from "crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { deliverOrderAlerts, pushProblem, sendTest, type Senders } from "./dispatch";
import type { PushOutcome } from "./webpush";
import { deviceOwner, forgetDevice, registerDevice, removeAdminDevice } from "./devices";

/**
 * Phase 21.6 phone push delivery against a real database: `npm run test:db`. The push
 * sender is a fake, so nothing leaves the machine; the device housekeeping is real.
 */
const RUN = import.meta.env.MODE === "db";

function vapidEnv() {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return {
    VAPID_PUBLIC_KEY: e.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: e.getPrivateKey().toString("base64url"),
    VAPID_SUBJECT: "mailto:test@example.com",
  };
}

describe.skipIf(!RUN)("phone push delivery (database)", () => {
  const ids = { h: "", other: "", mom: "", dad: "", stranger: "", kid: "", reward: "" };
  const saved = { ...process.env };
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") };

  beforeAll(async () => {
    Object.assign(process.env, vapidEnv());
    const h = await prisma.household.create({ data: { name: `e2e-push-${Date.now()}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const other = await prisma.household.create({ data: { name: `e2e-push-other-${Date.now()}` } });
    const stranger = await prisma.person.create({ data: { householdId: other.id, firstName: "Stranger", role: "ADMIN", isHouseholdMember: true } });
    const reward = await prisma.reward.create({ data: { householdId: h.id, title: "DJ in the car", pointCost: 20 } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, dad: dad.id, stranger: stranger.id, kid: kid.id, reward: reward.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
    for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const addPhone = (n: number, failureCount = 0) =>
    prisma.pushSubscription.create({
      data: { personId: ids.mom, endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}-${n}`, ...keys, failureCount },
    });

  const placeOrder = async () => {
    const order = await prisma.rewardOrder.create({
      data: { householdId: ids.h, rewardId: ids.reward, personId: ids.kid, title: "DJ in the car", cost: 20, status: "TO_DO" },
    });
    await prisma.notification.create({
      data: { householdId: ids.h, recipientId: ids.mom, kind: "ORDER_PLACED", title: "Ivy bought DJ in the car · 20 stickers", href: "/points#orders", orderId: order.id },
    });
    return order.id;
  };

  const fakes = (outcomes: Record<string, PushOutcome>) => {
    const push = vi.fn(async (sub: { endpoint: string }) => outcomes[sub.endpoint] ?? "ok");
    return { teams: vi.fn(), email: vi.fn(), push } as unknown as Senders & { push: typeof push };
  };

  test("pushes to every phone with no switch needed, and cleans up a gone one", async () => {
    await prisma.pushSubscription.deleteMany({ where: { personId: ids.mom } });
    const a = await addPhone(1);
    const b = await addPhone(2);
    const senders = fakes({ [b.endpoint]: "gone" });
    await deliverOrderAlerts(await placeOrder(), senders);

    expect(senders.push).toHaveBeenCalledTimes(2);
    const payload = (senders.push.mock.calls[0] as unknown[])[1];
    expect(payload).toEqual({ title: "FamilyOS", body: "Ivy bought DJ in the car · 20 stickers", path: "/points#orders" });
    expect(await prisma.pushSubscription.findUnique({ where: { id: b.id } })).toBeNull();
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { id: a.id } })).lastSuccessAt).not.toBeNull();
    expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).lastSentPush).not.toBeNull();
  });

  test("transient failures don't count; repeated rejections remove the phone at 5", async () => {
    await prisma.pushSubscription.deleteMany({ where: { personId: ids.mom } });
    const flaky = await addPhone(3);
    const dying = await addPhone(4, 4);
    const senders = fakes({ [flaky.endpoint]: "transient", [dying.endpoint]: "rejected" });
    await deliverOrderAlerts(await placeOrder(), senders);
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { id: flaky.id } })).failureCount).toBe(0);
    expect(await prisma.pushSubscription.findUnique({ where: { id: dying.id } })).toBeNull();
    expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).lastErrorPush).toBe(
      "Couldn't reach the phone right now. It'll try again with the next order.",
    );
  });

  test("missing server keys while phones exist is recorded, not silent", async () => {
    await prisma.pushSubscription.deleteMany({ where: { personId: ids.mom } });
    await addPhone(5);
    const key = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      const senders = fakes({});
      await deliverOrderAlerts(await placeOrder(), senders);
      expect(senders.push).not.toHaveBeenCalled();
      expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).lastErrorPush).toBe(pushProblem({ ok: false, reason: "badEnv" }));
    } finally {
      process.env.VAPID_PRIVATE_KEY = key;
    }
  });

  test("a test with no phones explains, and bad server keys are reported", async () => {
    await prisma.pushSubscription.deleteMany({ where: { personId: ids.mom } });
    expect(await sendTest(ids.h, ids.mom, "push", fakes({}))).toBe("No phones are set up for Mom yet.");
    const p = await addPhone(6);
    expect(await sendTest(ids.h, ids.mom, "push", fakes({ [p.endpoint]: "badVapid" }))).toMatch(/rejected this server's keys/);
    // The device isn't at fault, so it's kept and not counted.
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { id: p.id } })).failureCount).toBe(0);
  });

  test("a shared phone moves to whoever turned it on last, only within the family", async () => {
    const endpoint = `https://web.push.apple.com/e2e-shared-${Date.now()}`;
    expect(await registerDevice(ids.h, ids.mom, { endpoint, ...keys })).toEqual({ ok: true, previous: null });
    expect(await registerDevice(ids.h, ids.dad, { endpoint, ...keys })).toEqual({ ok: true, previous: "Mom" });
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    expect((await deviceOwner(ids.h, endpoint))?.person.firstName).toBe("Dad");

    // Another household can't take it over, see it, or delete it.
    expect(await registerDevice(ids.other, ids.stranger, { endpoint, ...keys })).toEqual({ ok: false, reason: "otherHousehold" });
    expect(await deviceOwner(ids.other, endpoint)).toBeNull();
    expect(await forgetDevice(ids.other, endpoint)).toBe(0);

    expect(await forgetDevice(ids.h, endpoint)).toBe(1);
  });

  test("any admin can remove an admin's phone; not a kid's, not another family's", async () => {
    const mine = await prisma.pushSubscription.create({
      data: { personId: ids.mom, endpoint: `https://fcm.googleapis.com/fcm/send/e2e-rm-${Date.now()}`, ...keys },
    });
    const kids = await prisma.pushSubscription.create({
      data: { personId: ids.kid, endpoint: `https://fcm.googleapis.com/fcm/send/e2e-kid-${Date.now()}`, ...keys },
    });
    expect(await removeAdminDevice(ids.other, mine.id)).toBe(0);
    expect(await removeAdminDevice(ids.h, kids.id)).toBe(0);
    expect(await removeAdminDevice(ids.h, mine.id)).toBe(1);
  });
});
