import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { renewDevice } from "./devices";

/**
 * Phase 68c against a real database (`npm run test:db`): a renewed subscription moves its row
 * within the household and keeps its person; another household's endpoint is never touched.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("renewing a phone's subscription (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", other: "", mom: "", them: "" };
  const keys = { p256dh: "p".repeat(87), auth: "a".repeat(22) };

  beforeAll(async () => {
    const [h, other] = await Promise.all([
      prisma.household.create({ data: { name: `e2e-renew-${t}` } }),
      prisma.household.create({ data: { name: `e2e-renew-other-${t}` } }),
    ]);
    const [mom, them] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADMIN", isHouseholdMember: true } }),
      prisma.person.create({ data: { householdId: other.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } }),
    ]);
    await prisma.pushSubscription.create({ data: { personId: mom.id, endpoint: `https://push.example.com/old-${t}`, ...keys, failureCount: 2 } });
    await prisma.pushSubscription.create({ data: { personId: them.id, endpoint: `https://push.example.com/theirs-${t}`, ...keys } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, them: them.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("moves the household's own row, keeps its person, and leaves others alone", async () => {
    expect(await renewDevice(ids.h, `https://push.example.com/old-${t}`, { endpoint: `https://push.example.com/new-${t}`, ...keys })).toBe(true);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: `https://push.example.com/new-${t}` } });
    expect(row).toMatchObject({ personId: ids.mom, failureCount: 0 });
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.com/old-${t}` } })).toBe(0);
    // Another household's device isn't ours to move, and ours can't take its address.
    expect(await renewDevice(ids.h, `https://push.example.com/theirs-${t}`, { endpoint: `https://push.example.com/x-${t}`, ...keys })).toBe(false);
    expect(await renewDevice(ids.h, `https://push.example.com/new-${t}`, { endpoint: `https://push.example.com/theirs-${t}`, ...keys })).toBe(false);
    expect(await prisma.pushSubscription.count({ where: { personId: ids.them } })).toBe(1);
  });
});
