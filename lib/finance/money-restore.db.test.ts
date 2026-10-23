import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildBackup } from "@/lib/backup/build";
import { applyRestore, previewRestore } from "@/lib/backup/restore";
import type { Backup } from "@/lib/backup/schema";
import { holdMoneySyncs, previewMoney, restoreMoney, sealMoney } from "./backup";
import { todayCivil } from "./budget";
import { visibleToWhere } from "./gifts";

/**
 * Phase 28.5 against a real database: `npm run test:db`. A household backup's sealed jars
 * come back as they were (surprises still hidden, duplicates still folded), on this server
 * or onto a fresh household where only the admin has signed in (grandma keeps her jar and
 * gets it when she signs in); an edited people list is refused; a restore that would orphan
 * a not-yet-signed-in member is refused; a running sync holds the restore off.
 */
const RUN = import.meta.env.MODE === "db";
const hooks = { sealMoney, previewMoney, restoreMoney };
const today = todayCivil();
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000);

describe.skipIf(!RUN)("putting money jars back (database)", { timeout: 120_000 }, () => {
  const t = Date.now();
  const ids = { h: "", h2: "", dad: "", mom: "", grandma: "", dad2: "" };
  const households: string[] = [];
  const users: string[] = [];
  let file: Backup;

  const linked = async (householdId: string, firstName: string, role: "ADMIN" | "ADULT", email: string) => {
    const user = await prisma.user.create({ data: { id: `e2e-mr-${firstName}-${householdId}`, name: firstName, email } });
    users.push(user.id);
    return prisma.person.create({ data: { householdId, firstName, role, isHouseholdMember: true, authUserId: user.id, email } });
  };
  const restore = async (householdId: string, viewerId: string, b: Backup, withMoney: boolean) => {
    const preview = await previewRestore(householdId, b, hooks);
    if (!preview.ok) return preview;
    return applyRestore(householdId, viewerId, b, { allowTimeZoneMismatch: false, expectedPlanDigest: preview.preview.planDigest, hooks, restoreMoney: withMoney });
  };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-mr-${t}` } });
    households.push(h.id);
    const dad = await linked(h.id, "Dad", "ADMIN", `dad-${t}@example.com`);
    const mom = await linked(h.id, "Mom", "ADULT", `mom-${t}@example.com`);
    const grandma = await linked(h.id, "Grandma", "ADULT", `grandma-${t}@example.com`);
    const family = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id, alertOverBudget: true }] } } });
    await prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's", members: { create: [{ personId: grandma.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: family.id, source: "SIMPLEFIN", externalId: `a-${t}`, name: "Checking" } });
    const cat = await prisma.finCategory.create({ data: { jarId: family.id, key: "fun", name: "Fun", kind: "SPEND", budgetCents: 5000 } });
    const lego = await prisma.finTransaction.create({
      data: { jarId: family.id, accountId: account.id, source: "SIMPLEFIN", externalId: "l1", postedOn: dayFrom(-2), amountCents: -12999, description: "LEGO STORE", merchantKey: "lego store", categoryId: cat.id, categorySource: "PERSON", giftById: dad.id, giftHiddenFrom: [mom.id], giftRevealOn: dayFrom(30) },
    });
    await prisma.finTransaction.create({
      data: { jarId: family.id, accountId: account.id, source: "MANUAL", externalId: "ofx:l1", postedOn: dayFrom(-2), amountCents: -12999, description: "LEGO", merchantKey: "lego", state: "DUPLICATE", duplicateOfId: lego.id },
    });
    await prisma.categoryRule.create({ data: { jarId: family.id, key: "lego store", categoryId: cat.id } });
    await prisma.privacyCharge.create({ data: { jarId: family.id, token: `pc-${t}`, merchant: "LEGO.COM", amountCents: 12999, status: "SETTLED", occurredAt: dayFrom(-3), matchedTxnId: lego.id } });
    await prisma.manualBill.create({ data: { jarId: family.id, name: "School fees", amountCents: 4500, cadence: "YEARLY", nextDue: new Date("2026-11-01T00:00:00Z"), matchKey: "school fees", createdById: dad.id } });
    // Phase 34: a balance day and a house valued twice.
    await prisma.finBalanceDay.create({ data: { accountId: account.id, day: new Date("2026-09-30T00:00:00Z"), balanceCents: 250_000 } });
    await prisma.finHolding.create({
      data: {
        jarId: family.id,
        name: "House",
        kind: "HOME",
        values: { create: [{ valuedOn: new Date("2019-06-01T00:00:00Z"), valueCents: 30_000_000 }, { valuedOn: new Date("2026-10-01T00:00:00Z"), valueCents: 45_000_000 }] },
      },
    });
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, grandma: grandma.id });
    file = await buildBackup(h.id, new Date(), { sealMoney });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const jarsOf = (householdId: string) =>
    prisma.moneyJar.findMany({
      where: { householdId },
      orderBy: { name: "asc" },
      select: {
        name: true,
        members: { select: { personId: true, alertOverBudget: true } },
        transactions: { orderBy: { externalId: "asc" }, select: { externalId: true, state: true, duplicateOfId: true, id: true, giftById: true, giftHiddenFrom: true, category: { select: { key: true } } } },
        privacy: { select: { matchedTxnId: true } },
        rules: { select: { key: true, category: { select: { key: true } } } },
        manualBills: { select: { name: true, amountCents: true, cadence: true, nextDue: true, matchKey: true, createdById: true } },
        accounts: { select: { name: true, balanceDays: { select: { day: true, balanceCents: true } } } },
        holdings: { select: { name: true, kind: true, values: { orderBy: { valuedOn: "asc" }, select: { valuedOn: true, valueCents: true } } } },
      },
    });

  test("same server: the file's jars replace today's, surprises and duplicates intact", async () => {
    // Today's jars drift from the file: a new jar, a deleted row.
    await prisma.moneyJar.create({ data: { householdId: ids.h, name: "Scratch", members: { create: [{ personId: ids.dad }] } } });
    await prisma.finTransaction.deleteMany({ where: { jar: { householdId: ids.h }, externalId: "ofx:l1" } });

    const preview = await previewRestore(ids.h, file, hooks);
    expect(preview.ok && preview.preview.money).toEqual({ canRestore: true, counts: { jars: 2, jarsSkipped: 0, membersKept: 3, membersWaiting: 0, membersDropped: 0 } });
    // Counts only: no jar name, no description anywhere in the preview.
    expect(JSON.stringify(preview)).not.toMatch(/LEGO|Family|Grandma's/);

    const r = await restore(ids.h, ids.dad, file, true);
    expect(r.ok && r.money?.restored.jars).toBe(2);
    expect(r.ok && r.money?.previousMemberIds.sort()).toEqual([ids.dad, ids.mom, ids.grandma].sort());

    const jars = await jarsOf(ids.h);
    expect(jars.map((j) => j.name)).toEqual(["Family", "Grandma's"]);
    const family = jars[0];
    expect(family.members).toEqual(expect.arrayContaining([{ personId: ids.mom, alertOverBudget: true }]));
    const [l1, ofx] = [family.transactions.find((x) => x.externalId === "l1")!, family.transactions.find((x) => x.externalId === "ofx:l1")!];
    expect(l1).toMatchObject({ giftById: ids.dad, giftHiddenFrom: [ids.mom], category: { key: "fun" } });
    expect(ofx).toMatchObject({ state: "DUPLICATE", duplicateOfId: l1.id });
    expect(family.privacy).toEqual([{ matchedTxnId: l1.id }]);
    expect(family.rules).toEqual([{ key: "lego store", category: { key: "fun" } }]);
    expect(family.manualBills).toEqual([{ name: "School fees", amountCents: 4500, cadence: "YEARLY", nextDue: new Date("2026-11-01T00:00:00Z"), matchKey: "school fees", createdById: null }]);
    expect(family.accounts).toEqual([{ name: "Checking", balanceDays: [{ day: new Date("2026-09-30T00:00:00Z"), balanceCents: 250_000 }] }]);
    expect(family.holdings).toEqual([
      {
        name: "House",
        kind: "HOME",
        values: [
          { valuedOn: new Date("2019-06-01T00:00:00Z"), valueCents: 30_000_000 },
          { valuedOn: new Date("2026-10-01T00:00:00Z"), valueCents: 45_000_000 },
        ],
      },
    ]);
    const momSees = await prisma.finTransaction.count({ where: { jar: { householdId: ids.h }, externalId: "l1", ...visibleToWhere(ids.mom, today) } });
    expect(momSees).toBe(0);
  });

  test("without the box ticked, jars stay exactly as they are", async () => {
    await prisma.moneyJar.create({ data: { householdId: ids.h, name: "Kept", members: { create: [{ personId: ids.dad }] } } });
    const r = await restore(ids.h, ids.dad, file, false);
    expect(r.ok && r.money).toBeNull();
    expect((await jarsOf(ids.h)).map((j) => j.name)).toEqual(["Family", "Grandma's", "Kept"]);
  });

  test("an edited people list can't re-point a jar member", async () => {
    const edited: Backup = structuredClone(file);
    const g = edited.people.find((p) => p.id === ids.grandma)!;
    g.email = `dad-${t}@example.com`;
    const m = edited.people.find((p) => p.id === ids.dad)!;
    m.email = `grandma-${t}@example.com`;
    const preview = await previewRestore(ids.h, edited, hooks);
    expect(preview.ok && preview.preview.money?.canRestore).toBe(false);
  });

  test("a fresh server: grandma's jar comes back, waiting for her first sign-in; then a money-less restore is refused", async () => {
    const h2 = await prisma.household.create({ data: { name: `e2e-mr2-${t}` } });
    households.push(h2.id);
    // The same Microsoft account signs in on the rebuilt server. (One shared test database:
    // the old server's sign-in row steps aside first; sign-in addresses are unique.)
    await prisma.user.update({ where: { id: `e2e-mr-Dad-${ids.h}` }, data: { email: `old-dad-${t}@example.com` } });
    const dad2 = await linked(h2.id, "Dad", "ADMIN", `dad-${t}@example.com`);
    Object.assign(ids, { h2: h2.id, dad2: dad2.id });

    const preview = await previewRestore(h2.id, file, hooks);
    expect(preview.ok && preview.preview.money).toMatchObject({ canRestore: true, counts: { jars: 2, membersKept: 3, membersWaiting: 2 } });
    const r = await restore(h2.id, dad2.id, file, true);
    expect(r.ok).toBe(true);
    const grandmaJar = await prisma.moneyJar.findFirstOrThrow({ where: { householdId: h2.id, name: "Grandma's" }, select: { members: { select: { person: { select: { email: true, authUserId: true } } } } } });
    expect(grandmaJar.members).toEqual([{ person: { email: `grandma-${t}@example.com`, authUserId: null } }]);

    // Grandma hasn't signed in: a restore that leaves jars alone would delete her row and her membership.
    const refused = await restore(h2.id, dad2.id, file, false);
    expect(refused.ok).toBe(false);
    expect(await prisma.moneyJar.count({ where: { householdId: h2.id } })).toBe(2);
  });

  test("a running bank sync holds the restore off; the hold is handed back", async () => {
    const jar = await prisma.moneyJar.findFirstOrThrow({ where: { householdId: ids.h, name: "Family" } });
    const conn = await prisma.jarConnection.create({
      data: { jarId: jar.id, provider: "PRIVACY", encryptedValue: new Uint8Array([1]), iv: new Uint8Array([1]), authTag: new Uint8Array([1]), leaseUntil: new Date(Date.now() + 60_000) },
    });
    expect(await holdMoneySyncs(ids.h)).toBeNull();
    await prisma.jarConnection.update({ where: { id: conn.id }, data: { leaseUntil: null } });
    const hold = await holdMoneySyncs(ids.h);
    expect(hold).not.toBeNull();
    expect((await prisma.jarConnection.findUniqueOrThrow({ where: { id: conn.id } })).leaseUntil).not.toBeNull();
    await hold!.release();
    expect((await prisma.jarConnection.findUniqueOrThrow({ where: { id: conn.id } })).leaseUntil).toBeNull();
  });
});
