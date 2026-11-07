import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCleanup } from "./retention";
import { readHeartbeats, recordFailure, recordOk } from "./heartbeat";

/** Phase 61 against a real database (`npm run test:db`): cleanup takes only the old, and heartbeats keep both times. */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("cleanup and heartbeats (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", person: "", user: `e2e-ret-${t}` };
  const day = 24 * 60 * 60_000;

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-retention-${t}` } });
    await prisma.user.create({ data: { id: ids.user, name: "Dad" } });
    const person = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADULT", isHouseholdMember: true, authUserId: ids.user } });
    Object.assign(ids, { h: h.id, person: person.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.systemHeartbeat.deleteMany({ where: { name: { startsWith: `test-${t}` } } });
  });

  test("only sessions long expired and notifications long read go", async () => {
    const now = new Date();
    await prisma.session.createMany({
      data: [
        { userId: ids.user, token: `old-${t}`, expiresAt: new Date(now.getTime() - 3 * day), updatedAt: now },
        { userId: ids.user, token: `recent-${t}`, expiresAt: new Date(now.getTime() - 60_000), updatedAt: now },
        { userId: ids.user, token: `live-${t}`, expiresAt: new Date(now.getTime() + day), updatedAt: now },
      ],
    });
    const base = { householdId: ids.h, recipientId: ids.person, kind: "BACKUP_MADE" as const, href: "/data#history" };
    await prisma.notification.createMany({
      data: [
        { ...base, title: "old read", readAt: new Date(now.getTime() - 100 * day) },
        { ...base, title: "recent read", readAt: new Date(now.getTime() - 10 * day) },
        { ...base, title: "old unread", createdAt: new Date(now.getTime() - 200 * day) },
      ],
    });
    const result = await runCleanup(now);
    expect(result.sessions).toBeGreaterThanOrEqual(1);
    expect((await prisma.session.findMany({ where: { userId: ids.user }, select: { token: true } })).map((s) => s.token).sort()).toEqual([`live-${t}`, `recent-${t}`]);
    expect((await prisma.notification.findMany({ where: { recipientId: ids.person }, select: { title: true } })).map((n) => n.title).sort()).toEqual(["old unread", "recent read"]);
  });

  test("a heartbeat keeps the last good run and the last failure apart", async () => {
    const name = `test-${t}-job`;
    await recordOk(name, "3 old sessions", new Date("2026-11-07T10:00:00Z"));
    class PrismaClientKnownRequestError extends Error {
      code = "P1001";
    }
    await recordFailure(name, new PrismaClientKnownRequestError("Can't reach the server at db:5432 for dad@example.com"), new Date("2026-11-07T10:30:00Z"));
    const row = (await readHeartbeats()).find((r) => r.name === name)!;
    expect(row).toMatchObject({ detail: "3 old sessions", lastError: "PrismaClientKnownRequestError P1001" });
    expect(row.lastOkAt?.toISOString()).toBe("2026-11-07T10:00:00.000Z");
    expect(row.lastErrorAt?.toISOString()).toBe("2026-11-07T10:30:00.000Z");
  });
});
