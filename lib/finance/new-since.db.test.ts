import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { todayCivil } from "./budget";
import { newSince } from "./new-since";

/**
 * Phase 64d against a real database (`npm run test:db`): the "New since you last looked" queue
 * shows what arrived since this member's last look (a first look: the last 30 days), never a
 * pending charge or a surprise hidden from them (a hold that posts on its own row is new then), and saving files changed rows and confirmed
 * guesses as the member's picks, leaves a rule's row alone, refuses another jar's category and
 * another jar's rows, and marks everything seen for this member only.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

const DAY = 86_400_000;

describe.skipIf(!RUN)("new since you last looked (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", jar: "", other: "", food: "", fun: "", otherCat: "" };
  const txn: Record<string, string> = {};
  const users: string[] = [];
  const today = todayCivil();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-new-since-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-ns-${firstName}-${t}`, name: firstName } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom] = await Promise.all([person("Dad"), person("Mom")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Mom's", members: { create: [{ personId: mom.id }] } } });
    const [food, fun, otherCat] = await Promise.all([
      prisma.finCategory.create({ data: { jarId: jar.id, key: "food", name: "Food", kind: "SPEND" } }),
      prisma.finCategory.create({ data: { jarId: jar.id, key: "fun", name: "Fun", kind: "SPEND" } }),
      prisma.finCategory.create({ data: { jarId: other.id, key: "food", name: "Food", kind: "SPEND" } }),
    ]);
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: `a-${t}`, name: "Checking" } });
    const otherAccount = await prisma.finAccount.create({ data: { jarId: other.id, source: "MANUAL", externalId: `b-${t}`, name: "Savings" } });
    const row = async (key: string, data: Record<string, unknown>, ageDays = 1, onJar = jar.id, onAccount = account.id) => {
      const r = await prisma.finTransaction.create({
        data: {
          jarId: onJar,
          accountId: onAccount,
          source: "MANUAL",
          externalId: `${key}-${t}`,
          postedOn: new Date(Date.now() - ageDays * DAY),
          createdAt: new Date(Date.now() - ageDays * DAY),
          amountCents: -1000,
          description: key.toUpperCase(),
          merchantKey: key,
          ...data,
        },
      });
      txn[key] = r.id;
    };
    await row("guessed", { categoryId: food.id, categorySource: "AUTO" });
    await row("ruled", { categoryId: food.id, categorySource: "RULE" });
    await row("changed", { categoryId: food.id, categorySource: "AUTO" });
    await row("bare", {});
    await row("pending", { pending: true });
    await row("surprise", { giftHiddenFrom: [dad.id], giftRevealOn: new Date(Date.now() + 30 * DAY) });
    await row("old", { categoryId: food.id, categorySource: "AUTO" }, 45);
    await row("elsewhere", { categoryId: otherCat.id, categorySource: "AUTO" }, 1, other.id, otherAccount.id);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, jar: jar.id, other: other.id, food: food.id, fun: fun.id, otherCat: otherCat.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const as = async (id: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id }, omit: { photo: true } });
  };
  const form = (entries: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const row = (key: string) => prisma.finTransaction.findUniqueOrThrow({ where: { id: txn[key] }, select: { categoryId: true, categorySource: true } });

  test("the queue: the last 30 days on a first look, never pending, a hidden surprise or another jar's", async () => {
    const dad = await newSince(ids.jar, ids.dad, null, today);
    expect(dad.rows.map((r) => r.name).sort()).toEqual(["BARE", "CHANGED", "GUESSED", "RULED"].map((n) => expect.stringMatching(new RegExp(n, "i"))));
    expect(dad.total).toBe(4);
    // Mom isn't the surprise's audience: she sees it.
    expect((await newSince(ids.jar, ids.mom, null, today)).total).toBe(5);
  });

  test("Save all files changes and guesses as Dad's picks, leaves the rule's row, and marks him seen", async () => {
    const { fileNewSince } = await import("@/app/(app)/finances/actions");
    await as(ids.dad);
    const asOf = Date.now();
    await fileNewSince(
      ids.jar,
      form([
        ["asOf", String(asOf)],
        ["id", txn.guessed],
        [`cat:${txn.guessed}`, ids.food],
        ["id", txn.ruled],
        [`cat:${txn.ruled}`, ids.food],
        ["id", txn.changed],
        [`cat:${txn.changed}`, ids.fun],
        // Another jar's category: that row is left alone.
        ["id", txn.bare],
        [`cat:${txn.bare}`, ids.otherCat],
        // Another jar's row, and an old one already seen: not touched.
        ["id", txn.elsewhere],
        [`cat:${txn.elsewhere}`, ids.food],
        ["id", txn.old],
        [`cat:${txn.old}`, ids.fun],
      ]),
    );
    expect(await row("guessed")).toEqual({ categoryId: ids.food, categorySource: "PERSON" });
    expect(await row("ruled")).toEqual({ categoryId: ids.food, categorySource: "RULE" });
    expect(await row("changed")).toEqual({ categoryId: ids.fun, categorySource: "PERSON" });
    expect(await row("bare")).toEqual({ categoryId: null, categorySource: null });
    expect(await row("elsewhere")).toEqual({ categoryId: ids.otherCat, categorySource: "AUTO" });
    expect(await row("old")).toEqual({ categoryId: ids.food, categorySource: "AUTO" });

    const members = await prisma.moneyJarMember.findMany({ where: { jarId: ids.jar }, select: { personId: true, lastSeenAt: true } });
    expect(members.find((m) => m.personId === ids.dad)?.lastSeenAt?.getTime()).toBe(asOf);
    expect(members.find((m) => m.personId === ids.mom)?.lastSeenAt).toBeNull();
    expect((await newSince(ids.jar, ids.dad, new Date(asOf), today)).total).toBe(0);

    const event = await prisma.jarEvent.findFirst({ where: { jarId: ids.jar, kind: "NEW_FILED" }, select: { actorId: true, data: true } });
    expect(event).toEqual({ actorId: ids.dad, data: { count: 2 } });
  });

  test("Mark all seen: a time from the future is clamped to now; another jar stays closed", async () => {
    const { markNewSeen } = await import("@/app/(app)/finances/actions");
    await as(ids.mom);
    const before = Date.now();
    await markNewSeen(ids.jar, form([["asOf", String(Date.now() + 365 * DAY)]]));
    const seen = (await prisma.moneyJarMember.findFirstOrThrow({ where: { jarId: ids.jar, personId: ids.mom } })).lastSeenAt!.getTime();
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(Date.now());

    await as(ids.dad);
    await expect(markNewSeen(ids.other, form([]))).rejects.toThrow("NOT_FOUND");
  });

  test("a hold that posts on its own row after a look is new again; an old page can't move the mark back", async () => {
    const { markNewSeen } = await import("@/app/(app)/finances/actions");
    const dadSeen = (await prisma.moneyJarMember.findFirstOrThrow({ where: { jarId: ids.jar, personId: ids.dad } })).lastSeenAt!;
    expect((await newSince(ids.jar, ids.dad, dadSeen, today)).total).toBe(0);
    // What lib/finance/sync.ts does when the bank keeps the hold's id.
    await prisma.finTransaction.update({ where: { id: txn.pending }, data: { pending: false, postedAt: new Date() } });
    expect((await newSince(ids.jar, ids.dad, dadSeen, today)).rows.map((r) => r.id)).toEqual([txn.pending]);

    await as(ids.dad);
    await markNewSeen(ids.jar, form([["asOf", String(dadSeen.getTime() - 5 * DAY)]]));
    expect((await prisma.moneyJarMember.findFirstOrThrow({ where: { jarId: ids.jar, personId: ids.dad } })).lastSeenAt).toEqual(dadSeen);
  });
});
