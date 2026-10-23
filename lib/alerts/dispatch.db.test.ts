import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { deliverNotifications, deliverOrderAlerts, sendTest, type Senders } from "./dispatch";
import { householdTeamsAad } from "./teams";
import { findAlertTarget, listAlertTargets } from "./targets";

/**
 * Phase 21.5 alert delivery against a real database: `npm run test:db`. Senders are fakes,
 * so nothing leaves the machine. The family has one Teams link; each admin is reached at
 * their Microsoft sign-in address.
 */
const RUN = import.meta.env.MODE === "db";

const URL_A = "https://prod-00.example.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=A";

describe.skipIf(!RUN)("alert delivery (database)", () => {
  const ids = { h: "", other: "", mom: "", dad: "", grandma: "", kid: "", gone: "", outsider: "", reward: "", userIds: [] as string[] };
  const tag = `e2e-alerts-${Date.now()}`;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: tag } });
    const other = await prisma.household.create({ data: { name: `${tag}-other` } });
    const user = (email: string) =>
      prisma.user.create({ data: { id: `${tag}-${email}`, name: email, email, emailVerified: true } });
    const momUser = await user(`mom-${tag}@example.com`);
    // Mom signs in with Microsoft: Teams reaches only those (Phase 40.2c).
    await prisma.account.create({ data: { userId: momUser.id, providerId: "microsoft", accountId: `${tag}-mom-oid` } });
    ids.userIds = [momUser.id];
    const mk = (firstName: string, role: "ADMIN" | "ADULT" | "KID", extra: object = {}, householdId = h.id) =>
      prisma.person.create({ data: { householdId, firstName, role, isHouseholdMember: true, ...extra } });
    const mom = await mk("Mom", "ADMIN", { authUserId: momUser.id, email: "mom-personal@example.com" });
    // Dad hasn't signed in with Microsoft yet; his profile email is a personal address.
    const dad = await mk("Dad", "ADMIN", { email: "dad-personal@example.com" });
    const grandma = await mk("Grandma", "ADULT");
    const kid = await mk("Ivy", "KID");
    const gone = await mk("Gone", "ADMIN", { isHouseholdMember: false });
    const outsider = await mk("Outsider", "ADMIN", {}, other.id);
    const enc = encryptSecret(URL_A, householdTeamsAad(h.id));
    await prisma.householdAlerts.create({
      data: {
        householdId: h.id,
        teamsWebhookEnc: new Uint8Array(enc.encryptedValue),
        teamsWebhookIv: new Uint8Array(enc.iv),
        teamsWebhookTag: new Uint8Array(enc.authTag),
        teamsWebhookHost: "prod-00.example.logic.azure.com",
        updatedByPersonId: mom.id,
      },
    });
    await prisma.alertPrefs.createMany({
      data: [
        { personId: mom.id, teamsEnabled: true, emailEnabled: true },
        { personId: dad.id, teamsEnabled: true },
      ],
    });
    const reward = await prisma.reward.create({ data: { householdId: h.id, title: "DJ in the car", emoji: "🎵", pointCost: 20 } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, dad: dad.id, grandma: grandma.id, kid: kid.id, gone: gone.id, outsider: outsider.id, reward: reward.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
  });

  // Builds an order and its bell notifications directly (a kernel test mustn't import the
  // store domain), shaped like placeOrder's.
  const placeOrder = async () => {
    const order = await prisma.rewardOrder.create({
      data: { householdId: ids.h, rewardId: ids.reward, personId: ids.kid, title: "DJ in the car", emoji: "🎵", cost: 20, status: "TO_DO" },
    });
    await prisma.notification.createMany({
      data: [ids.mom, ids.dad].map((recipientId) => ({
        householdId: ids.h,
        recipientId,
        kind: "ORDER_PLACED" as const,
        title: "Ivy bought 🎵 DJ in the car · 20 stickers",
        href: "/points#orders",
        orderId: order.id,
      })),
    });
    return { orderId: order.id };
  };

  const fakes = () => {
    const s = { teams: vi.fn(async () => {}), email: vi.fn(async () => {}) };
    return s as typeof s & Senders;
  };

  test("Teams uses the family link and each admin's Microsoft sign-in address", async () => {
    const placed = await placeOrder();
    const senders = fakes();
    await deliverOrderAlerts(placed.orderId, senders);

    expect(senders.teams).toHaveBeenCalledTimes(1);
    expect(senders.teams.mock.calls[0]).toEqual([
      URL_A,
      `mom-${tag}@example.com`,
      "Ivy bought 🎵 DJ in the car · 20 stickers",
      expect.stringMatching(/\/points#orders$/),
    ]);
    // Email prefers the sign-in address too.
    expect((senders.email.mock.calls[0] as unknown[])[0]).toBe(`mom-${tag}@example.com`);

    // Dad's personal profile email is never used for Teams.
    const dad = await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.dad } });
    expect(dad.lastErrorTeams).toBe("Dad needs to sign in here with Microsoft once before Teams can reach them.");
  });

  test("Phase 27 teams-first: Teams without the store switch, with its own card, and no email", async () => {
    const card = { heading: "💰 Money", linkText: "Open Money" };
    const notes = await Promise.all(
      [ids.mom, ids.grandma].map((recipientId) =>
        prisma.notification.create({
          data: { householdId: ids.h, recipientId, kind: "MONEY_BILL_DUE", title: "🧾 Netflix is due about Oct 7 (Family)", href: "/finances/j/bills" },
        }),
      ),
    );
    const senders = fakes();
    await deliverNotifications({ id: { in: notes.map((n) => n.id) } }, { channels: "teams-first", card }, senders);
    // Mom has email on for store orders; money alerts don't use it.
    expect(senders.email).not.toHaveBeenCalled();
    expect(senders.teams).toHaveBeenCalledTimes(1);
    expect(senders.teams.mock.calls[0]).toEqual([URL_A, `mom-${tag}@example.com`, "🧾 Netflix is due about Oct 7 (Family)", expect.stringMatching(/\/finances\/j\/bills$/), card]);
    // Grandma never switched Teams on (no AlertPrefs) and is still tried; she has no Microsoft sign-in yet.
    const g = await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.grandma } });
    expect(g.lastErrorTeams).toBe("Grandma needs to sign in here with Microsoft once before Teams can reach them.");
  });

  test("a failing channel doesn't stop the others and keeps its error as fixed text", async () => {
    const placed = await placeOrder();
    const senders = fakes();
    senders.teams.mockRejectedValueOnce(new Error("Couldn't reach Teams."));
    await deliverOrderAlerts(placed.orderId, senders);
    expect(senders.email).toHaveBeenCalled();
    const mom = await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } });
    expect(mom.lastErrorTeams).toBe("Couldn't reach Teams.");
  });

  test("an unknown order is a quiet no-op, and tests reach only the chosen channel", async () => {
    const senders = fakes();
    await deliverOrderAlerts("no-such-order", senders);
    expect(senders.teams).not.toHaveBeenCalled();
    expect(await sendTest(ids.h, ids.mom, "teams", senders)).toBeNull();
    expect(senders.teams).toHaveBeenCalledTimes(1);
    expect(senders.email).not.toHaveBeenCalled();
    await expect(sendTest(ids.other, ids.mom, "teams", senders)).rejects.toThrow();
  });

  test("without a family link, orders skip Teams silently; a test explains why", async () => {
    const saved = await prisma.householdAlerts.findUniqueOrThrow({ where: { householdId: ids.h } });
    await prisma.householdAlerts.update({ where: { householdId: ids.h }, data: { teamsWebhookEnc: null } });
    try {
      await prisma.alertPrefs.update({ where: { personId: ids.mom }, data: { lastErrorTeams: null } });
      const placed = await placeOrder();
      const senders = fakes();
      await deliverOrderAlerts(placed.orderId, senders);
      expect(senders.teams).not.toHaveBeenCalled();
      expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.mom } })).lastErrorTeams).toBeNull();
      expect(await sendTest(ids.h, ids.mom, "teams", senders)).toBe("Teams isn't set up for the family yet.");
    } finally {
      await prisma.householdAlerts.update({ where: { householdId: ids.h }, data: { teamsWebhookEnc: saved.teamsWebhookEnc } });
    }
  });

  test("an unreadable family link says to paste it again", async () => {
    const saved = await prisma.householdAlerts.findUniqueOrThrow({ where: { householdId: ids.h } });
    await prisma.householdAlerts.update({ where: { householdId: ids.h }, data: { teamsWebhookTag: new Uint8Array(16) } });
    try {
      expect(await sendTest(ids.h, ids.mom, "teams", fakes())).toBe("The family's Teams link can't be read anymore. Paste it again.");
      // On a real order it isn't silent either: every Teams recipient gets the fixed text.
      await prisma.alertPrefs.update({ where: { personId: ids.dad }, data: { lastErrorTeams: null } });
      const placed = await placeOrder();
      const senders = fakes();
      await deliverOrderAlerts(placed.orderId, senders);
      expect(senders.teams).not.toHaveBeenCalled();
      expect(senders.email).toHaveBeenCalled();
      expect((await prisma.alertPrefs.findUniqueOrThrow({ where: { personId: ids.dad } })).lastErrorTeams).toBe(
        "The family's Teams link can't be read anymore. Paste it again.",
      );
    } finally {
      await prisma.householdAlerts.update({ where: { householdId: ids.h }, data: { teamsWebhookTag: saved.teamsWebhookTag } });
    }
  });

  test("only current admins of this household are alert targets", async () => {
    expect(await findAlertTarget(ids.h, ids.mom)).toMatchObject({ id: ids.mom });
    expect(await findAlertTarget(ids.h, ids.dad)).toMatchObject({ id: ids.dad });
    expect(await findAlertTarget(ids.h, ids.grandma)).toBeNull();
    expect(await findAlertTarget(ids.h, ids.kid)).toBeNull();
    expect(await findAlertTarget(ids.h, ids.gone)).toBeNull();
    expect(await findAlertTarget(ids.h, ids.outsider)).toBeNull();
    expect((await listAlertTargets(ids.h)).map((p) => p.firstName)).toEqual(["Dad", "Mom"]);
  });
});
