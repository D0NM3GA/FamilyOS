import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { setAppOn } from "./app-switches";

/**
 * Phase 36 against a real database: `npm run test:db`. Skipped by plain `npm test`. Saving the
 * switches (only real switches, kept clean, the Outlook sync told), and the background work
 * that pauses while an app is off: bank syncs and money alerts, school feeds, the Outlook
 * sync. A throwaway household, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

const DAY = 86_400_000;

describe.skipIf(!RUN)("app switches (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", jar: "", conn: "", feed: "", sync: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-switches-${t}`, timezone: "America/New_York" } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-sw-${firstName}-${t}`, name: firstName, email: `${firstName}-sw-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADMIN", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom] = await Promise.all([person("Dad"), person("Mom")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const { saveConnection } = await import("@/lib/finance/sync");
    const conn = await saveConnection(jar.id, "SIMPLEFIN", "https://u:p@bridge.example/simplefin", dad.id);
    // Due in two days: a bill alert for each member, once Money is on.
    const { todayCivil } = await import("@/lib/finance/budget");
    const nextDue = new Date(Date.parse(`${todayCivil()}T00:00:00Z`) + 2 * DAY);
    await prisma.manualBill.create({
      data: { jarId: jar.id, name: "Car registration", amountCents: 9500, cadence: "YEARLY", nextDue, createdById: dad.id },
    });
    // claimStaleFeeds never reads the address, so placeholder bytes do.
    const feed = await prisma.schoolFeed.create({
      data: {
        householdId: h.id,
        name: "School",
        encryptedValue: new Uint8Array([1]),
        iv: new Uint8Array([1]),
        authTag: new Uint8Array([1]),
        urlHash: `hash-${t}`,
        host: "school.example",
      },
    });
    const sync = await prisma.calendarSync.create({ data: { householdId: h.id, ownerPersonId: mom.id, calendarId: "cal-1", calendarName: "Test" } });
    Object.assign(ids, { h: h.id, jar: jar.id, conn: conn.id, feed: feed.id, sync: sync.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const stored = async () => (await prisma.household.findUniqueOrThrow({ where: { id: ids.h }, select: { disabledApps: true } })).disabledApps;

  test("only apps with a switch, and only on or off, are saved", async () => {
    for (const app of ["home", "people", "data", "settings", "garage", "nope", "", 42, null]) {
      expect(await setAppOn(ids.h, app, false)).toMatchObject({ ok: false });
    }
    expect(await setAppOn(ids.h, "money", "off")).toMatchObject({ ok: false });
    expect(await stored()).toEqual([]);
  });

  test("switching apps keeps the list clean, and the Outlook sync hears when its sources change", async () => {
    const changedAt = async () => (await prisma.calendarSync.findUniqueOrThrow({ where: { id: ids.sync } })).optionsChangedAt;
    expect(await setAppOn(ids.h, "store", false)).toEqual({ ok: true, disabled: ["store"] });
    expect(await setAppOn(ids.h, "store", false)).toEqual({ ok: true, disabled: ["store"] });
    expect(await changedAt()).toBeNull(); // the Store puts nothing on the calendar
    expect(await setAppOn(ids.h, "chores", false)).toEqual({ ok: true, disabled: ["chores", "store"] });
    expect(await changedAt()).not.toBeNull();
    expect(await setAppOn(ids.h, "chores", true)).toEqual({ ok: true, disabled: ["store"] });
    expect(await setAppOn(ids.h, "store", true)).toEqual({ ok: true, disabled: [] });
    expect(await stored()).toEqual([]);
  });

  test("Money off: no bank syncs and no money alerts, until it's back on", async () => {
    const { claimConnections } = await import("@/lib/finance/sync");
    const { evaluateMoneyAlerts } = await import("@/lib/finance/alerts");
    const billAlerts = () => prisma.notification.count({ where: { householdId: ids.h, kind: "MONEY_BILL_DUE" } });

    await setAppOn(ids.h, "money", false);
    expect(await claimConnections(ids.jar, { force: false })).toEqual([]);
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    expect(await billAlerts()).toBe(0);

    await setAppOn(ids.h, "money", true);
    expect(await claimConnections(ids.jar, { force: false })).toEqual([ids.conn]);
    await evaluateMoneyAlerts(new Date(), vi.fn(async () => {}));
    expect(await billAlerts()).toBe(2);
    await prisma.jarConnection.update({ where: { id: ids.conn }, data: { leaseUntil: null } });
  });

  test("School off: its calendar feeds aren't refreshed", async () => {
    const { claimStaleFeeds } = await import("@/lib/school/feeds/refresh");
    await setAppOn(ids.h, "school", false);
    expect(await claimStaleFeeds(ids.h)).toEqual([]);
    await setAppOn(ids.h, "school", true);
    expect(await claimStaleFeeds(ids.h)).toEqual([ids.feed]);
  });

  test("the bell leaves out pings into a turned-off app, without marking them read", async () => {
    const { markAllRead, recentNotifications, unreadCount } = await import("@/lib/notifications");
    const dad = await prisma.person.findFirstOrThrow({ where: { householdId: ids.h, firstName: "Dad" }, select: { id: true } });
    // Start from an empty inbox (the money test above left him a bill alert).
    await prisma.notification.deleteMany({ where: { recipientId: dad.id } });
    await prisma.notification.createMany({
      data: [
        { householdId: ids.h, recipientId: dad.id, kind: "ORDER_PLACED", title: "Ivy bought a sticker", href: "/points#orders" },
        { householdId: ids.h, recipientId: dad.id, kind: "BACKUP_MADE", title: "A backup was made", href: "/data#history" },
      ],
    });
    const disabled = ["store"];
    expect(await unreadCount(dad.id, disabled)).toBe(1);
    expect((await recentNotifications(dad.id, 10, disabled)).map((n) => n.href)).toEqual(["/data#history"]);
    await markAllRead(dad.id, disabled);
    expect(await unreadCount(dad.id, disabled)).toBe(0);
    // Back with the Store, still unread.
    expect(await unreadCount(dad.id, [])).toBe(1);
  });

  test("Calendar off: the Outlook sync is paused, and nothing about it changes", async () => {
    const { runSync } = await import("@/lib/calendar-sync/run");
    const graph = vi.fn(async () => {
      throw new Error("Graph should not be called while Calendar is off");
    });
    await setAppOn(ids.h, "calendar", false);
    expect(await runSync({ syncId: ids.sync, graph })).toEqual({ status: "skipped", reason: "off" });
    expect(graph).not.toHaveBeenCalled();
    expect(await prisma.calendarSync.findUniqueOrThrow({ where: { id: ids.sync } })).toMatchObject({ lastSyncedAt: null, lastResult: null });
    await setAppOn(ids.h, "calendar", true);
  });
});
