import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildBackup } from "@/lib/backup/build";
import { BACKUP_SCHEMA_VERSION } from "@/lib/backup/schema";
import { backupHistory, recordBackupEvent } from "@/lib/backup/audit";
import { buildMyMoneyBackup, sealMoney, unsealMoney } from "./backup";
import { todayCivil } from "./budget";

/**
 * Phase 28 against a real database: `npm run test:db`. The household backup carries every
 * jar sealed (nothing readable), a person's own copy has only what they see (no surprise
 * meant for them, not even through a Privacy charge, a rule or a Bills answer), and every
 * backup is recorded and told to the right people.
 */
const RUN = import.meta.env.MODE === "db";

const DAY = 86_400_000;
const today = todayCivil();
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY);

describe.skipIf(!RUN)("money in backups (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", grandma: "", gone: "", kid: "", family: "", gJar: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-moneybk-${t}` } });
    const person = async (firstName: string, role: "ADMIN" | "ADULT" | "KID", linked = true) => {
      let authUserId: string | null = null;
      if (linked) {
        const user = await prisma.user.create({ data: { id: `e2e-mb-${firstName}-${t}`, name: firstName, email: `${firstName}-${t}@example.com` } });
        users.push(user.id);
        authUserId = user.id;
      }
      return prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true, authUserId } });
    };
    const [dad, mom, grandma, gone, kid] = await Promise.all([
      person("Dad", "ADMIN"),
      person("Mom", "ADULT"),
      person("Grandma", "ADULT"),
      person("Gone", "ADULT"),
      person("Kid", "KID", false),
    ]);
    const family = await prisma.moneyJar.create({
      data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }, { personId: gone.id }] } },
    });
    const gJar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's", members: { create: [{ personId: grandma.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: family.id, source: "SIMPLEFIN", externalId: `a-${t}`, name: "Checking" } });
    const row = (externalId: string, description: string, amountCents: number, extra: object = {}) =>
      prisma.finTransaction.create({
        data: { jarId: family.id, accountId: account.id, source: "SIMPLEFIN", externalId, postedOn: dayFrom(-2), amountCents, description, merchantKey: description.toLowerCase(), ...extra },
      });
    await row("c1", "COFFEE", -450);
    const lego = await row("l1", "LEGO STORE", -12999, { giftById: dad.id, giftHiddenFrom: [mom.id], giftRevealOn: dayFrom(30) });
    const cat = await prisma.finCategory.create({ data: { jarId: family.id, key: "fun", name: "Fun", kind: "SPEND" } });
    await prisma.categoryRule.create({ data: { jarId: family.id, key: "lego store", categoryId: cat.id } });
    await prisma.categoryRule.create({ data: { jarId: family.id, key: "coffee", categoryId: cat.id } });
    await prisma.recurringMark.create({ data: { jarId: family.id, key: "lego store", status: "KEEP" } });
    await prisma.privacyCharge.create({ data: { jarId: family.id, token: `pc1-${t}`, merchant: "LEGO.COM", amountCents: 12999, status: "SETTLED", occurredAt: dayFrom(-3), matchedTxnId: lego.id } });
    await prisma.privacyCharge.create({ data: { jarId: family.id, token: `pc2-${t}`, merchant: "SECRET SHOP", amountCents: 5000, status: "PENDING", occurredAt: dayFrom(-1) } });
    // Twins of the surprise that never got the mark: a folded statement row and a dropped
    // pending row. Nobody sees them in the app, so they must not be in anyone's own copy.
    const stmtAccount = await prisma.finAccount.create({ data: { jarId: family.id, source: "MANUAL", externalId: `m-${t}`, name: "Statements" } });
    await prisma.finTransaction.create({
      data: { jarId: family.id, accountId: stmtAccount.id, source: "MANUAL", externalId: "ofx:l1", postedOn: dayFrom(-2), amountCents: -12999, description: "LEGO STORE TWIN", merchantKey: "lego store", state: "DUPLICATE", duplicateOfId: lego.id },
    });
    await row("p-l1", "PENDING LEGO STORE", -12999, { pending: true, state: "SUPERSEDED" });
    await prisma.person.update({ where: { id: gone.id }, data: { isHouseholdMember: false, role: null } });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, grandma: grandma.id, gone: gone.id, kid: kid.id, family: family.id, gJar: gJar.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  test("the household backup carries every jar, sealed: nothing readable in the file", async () => {
    const backup = await buildBackup(ids.h, new Date(), { sealMoney });
    const text = JSON.stringify(backup);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.sealedMoney?.jarCount).toBe(2);
    expect(text).not.toMatch(/LEGO|COFFEE|SECRET|Grandma's/);
    const opened = unsealMoney(backup.sealedMoney!);
    expect(opened.jars.map((j) => j.name).sort()).toEqual(["Family", "Grandma's"]);
    const lego = opened.jars.find((j) => j.name === "Family")!.transactions.find((x) => x.externalId === "l1")!;
    expect(lego).toMatchObject({ giftById: ids.dad, giftHiddenFrom: [ids.mom] });
    // Without the hook (any other caller), no money at all.
    expect((await buildBackup(ids.h)).sealedMoney).toBeNull();
  });

  test("a person's own copy: their jars, as they see them, nothing that names a surprise for them", async () => {
    const mine = await buildMyMoneyBackup(ids.mom, ids.h, today);
    const text = JSON.stringify(mine);
    expect(mine.jars.map((j) => j.name)).toEqual(["Family"]);
    expect(text).not.toMatch(/lego|LEGO|SECRET|Grandma/i);
    const jar = mine.jars[0];
    expect(jar.transactions.map((x) => x.description)).toEqual(["COFFEE"]);
    expect(jar.alwaysRules.map((r) => r.key)).toEqual(["coffee"]);
    expect(jar.billAnswers).toEqual([]);
    expect(jar.surprisesNotIncluded).toBe(1);
    expect(text).not.toContain(ids.dad);

    const dads = await buildMyMoneyBackup(ids.dad, ids.h, today);
    const lego = dads.jars[0].transactions.find((x) => x.description === "LEGO STORE")!;
    expect(lego).toMatchObject({ surprise: { for: ["Mom"] } });
    expect(lego.privacyCharges.map((p) => p.merchant)).toEqual(["LEGO.COM"]);
    // An unmatched Privacy charge is in nobody's own copy (it's shown nowhere in the app).
    expect(JSON.stringify(dads)).not.toContain("SECRET SHOP");
  });

  test("Phase 34: a person's own copy has Net worth's balance history and things valued by hand", async () => {
    const account = await prisma.finAccount.create({ data: { jarId: ids.family, source: "SIMPLEFIN", externalId: `nw-${Date.now()}`, name: "Savings", balanceCents: 900_000 } });
    await prisma.finBalanceDay.create({ data: { accountId: account.id, day: new Date("2026-09-30T00:00:00Z"), balanceCents: 880_000 } });
    const car = await prisma.finHolding.create({ data: { jarId: ids.family, name: "Car loan", kind: "LOAN", values: { create: { valuedOn: new Date("2026-10-01T00:00:00Z"), valueCents: 1_200_000 } } } });
    try {
      const jar = (await buildMyMoneyBackup(ids.mom, ids.h, today)).jars[0];
      expect(jar.accounts.find((a) => a.name === "Savings")?.balanceHistory).toEqual([{ day: "2026-09-30", balanceCents: 880_000 }]);
      expect(jar.ownedOrOwed).toEqual([{ name: "Car loan", kind: "LOAN", values: [{ valuedOn: "2026-10-01", valueCents: 1_200_000 }] }]);
      // Grandma's own copy: not her jar.
      expect(JSON.stringify(await buildMyMoneyBackup(ids.grandma, ids.h, today))).not.toContain("Car loan");
    } finally {
      await prisma.finHolding.delete({ where: { id: car.id } });
      await prisma.finAccount.delete({ where: { id: account.id } });
    }
  });

  test("every backup is recorded, and told to the admins and jar members (never the removed or kids)", async () => {
    const household = await recordBackupEvent({
      householdId: ids.h,
      actorId: ids.dad,
      actorName: "Dad",
      kind: "HOUSEHOLD_BACKUP",
      includesMoney: true,
      jarCount: 2,
      fileText: '{"a":1}',
    });
    const event = await prisma.backupEvent.findUniqueOrThrow({ where: { id: household.eventId } });
    expect(event.notifiedIds.sort()).toEqual([ids.mom, ids.grandma].sort());
    expect(event).toMatchObject({ fileSha256: "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862", bytes: 7, includesMoney: true });
    const notes = await prisma.notification.findMany({ where: { id: { in: household.notificationIds } } });
    expect(notes.every((n) => n.kind === "BACKUP_MADE" && n.title.includes("sealed") && !n.title.includes("Family"))).toBe(true);

    const own = await recordBackupEvent({ householdId: ids.h, actorId: ids.mom, actorName: "Mom", kind: "MONEY_BACKUP", includesMoney: true, jarCount: 1, fileText: "x" });
    // Mom and her Family jar-mate Dad are told (the removed member isn't); Grandma isn't in that jar.
    expect((await prisma.backupEvent.findUniqueOrThrow({ where: { id: own.eventId } })).notifiedIds.sort()).toEqual([ids.mom, ids.dad].sort());
    const ownNotes = await prisma.notification.findMany({ where: { id: { in: own.notificationIds } } });
    expect(ownNotes.find((n) => n.recipientId === ids.dad)?.title).toBe("🗄️ Mom downloaded a copy of a money jar you share.");
    expect(ownNotes.find((n) => n.recipientId === ids.mom)?.title).toContain("A copy of your money jars");
    // Pressed again right away: recorded, not announced again.
    const again = await recordBackupEvent({ householdId: ids.h, actorId: ids.mom, actorName: "Mom", kind: "MONEY_BACKUP", includesMoney: true, jarCount: 1, fileText: "x" });
    expect(again.notificationIds).toEqual([]);
    expect(await prisma.backupEvent.count({ where: { householdId: ids.h, kind: "MONEY_BACKUP" } })).toBe(2);

    const seen = async (personId: string, role: string | null) => (await backupHistory({ id: personId, householdId: ids.h, role })).map((e) => e.kind).sort();
    expect(await seen(ids.mom, "ADULT")).toEqual(["HOUSEHOLD_BACKUP", "MONEY_BACKUP", "MONEY_BACKUP"]);
    expect(await seen(ids.grandma, "ADULT")).toEqual(["HOUSEHOLD_BACKUP"]);
    expect(await seen(ids.kid, "KID")).toEqual([]);
    // An admin sees household backups, and someone's own-jar copy only as that jar's member
    // (told once; the quick repeat isn't announced). An admin outside the jar would see none.
    expect(await seen(ids.dad, "ADMIN")).toEqual(["HOUSEHOLD_BACKUP", "MONEY_BACKUP"]);
  });
});
