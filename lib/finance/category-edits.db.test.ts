import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { todayCivil } from "./budget";
import { addCategory, removeCategory, renameCategory } from "./category-edits";
import { jarHistory } from "./history";
import { categorizeJar, ensureCategories, linkGroceries } from "./organize";

/**
 * Phase 37's jar categories against a real database: `npm run test:db`. Removing one moves
 * every charge (hidden, duplicate and rule-set ones too) and every rule to the target, merges
 * its budget and saving up into the target's, hands its key on (guesses and grocery trips
 * follow it), survives a tidy-up running at the same moment, and leaves other jars alone;
 * built-ins and a different kind are refused; names are unique per jar ignoring case; the
 * actions are members-only and write the jar's history.
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
  return { ...real, requireActiveProfile: async () => who.profile, getActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isOwnSignIn: async () => true };
});

const DAY = 86_400_000;
const today = todayCivil();
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayFrom = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

describe.skipIf(!RUN)("a jar's own categories (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", mom: "", outsider: "", jar: "", other: "", checking: "", otherChecking: "" };
  const users: string[] = [];
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-categories-${t}` } });
    const person = async (firstName: string) => {
      const user = await prisma.user.create({ data: { id: `e2e-ce-${firstName}-${t}`, name: firstName, email: `${firstName}-ce-${t}@example.com` } });
      users.push(user.id);
      return prisma.person.create({ data: { householdId: h.id, firstName, role: "ADULT", isHouseholdMember: true, authUserId: user.id } });
    };
    const [dad, mom, outsider] = await Promise.all([person("Dad"), person("Mom"), person("Outsider")]);
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }, { personId: mom.id }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Outsider's", members: { create: [{ personId: outsider.id }] } } });
    const checking = await prisma.finAccount.create({ data: { jarId: jar.id, source: "SIMPLEFIN", externalId: `chk-${t}`, name: "Checking" } });
    const otherChecking = await prisma.finAccount.create({ data: { jarId: other.id, source: "SIMPLEFIN", externalId: `ochk-${t}`, name: "Their checking" } });
    await Promise.all([ensureCategories(prisma, jar.id), ensureCategories(prisma, other.id)]);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, outsider: outsider.id, jar: jar.id, other: other.id, checking: checking.id, otherChecking: otherChecking.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const cat = (jarId: string, key: string) => prisma.finCategory.findUniqueOrThrow({ where: { jarId_key: { jarId, key } } });
  const charge = (jarId: string, accountId: string, externalId: string, merchantKey: string, extra: object = {}) =>
    prisma.finTransaction.create({
      data: { jarId, accountId, source: "SIMPLEFIN", externalId, postedOn: asDate(today), amountCents: -1500, description: merchantKey.toUpperCase(), merchantKey, ...extra },
    });
  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  test("removing moves every charge, rule and budget to the target, and leaves other jars alone", async () => {
    const [dining, other, theirDining] = await Promise.all([cat(ids.jar, "dining"), cat(ids.jar, "other"), cat(ids.other, "dining")]);
    await prisma.finCategory.update({ where: { id: dining.id }, data: { budgetCents: 20000, rollover: true, rolloverFrom: today.slice(0, 7) } });
    await prisma.categoryRule.create({ data: { jarId: ids.jar, key: "chipotle", categoryId: dining.id } });
    const theirRule = await prisma.categoryRule.create({ data: { jarId: ids.other, key: "chipotle", categoryId: theirDining.id } });
    const guessed = await charge(ids.jar, ids.checking, "d1", "starbucks", { categoryId: dining.id, categorySource: "AUTO" });
    const picked = await charge(ids.jar, ids.checking, "d2", "corner cafe", { categoryId: dining.id, categorySource: "PERSON" });
    const ruled = await charge(ids.jar, ids.checking, "d3", "chipotle", { categoryId: dining.id, categorySource: "RULE" });
    // A surprise for Mom, and a folded duplicate: moved too.
    const surprise = await charge(ids.jar, ids.checking, "d4", "fancy bistro", {
      categoryId: dining.id,
      categorySource: "PERSON",
      giftById: ids.dad,
      giftHiddenFrom: [ids.mom],
      giftRevealOn: asDate(dayFrom(30)),
    });
    const duplicate = await charge(ids.jar, ids.checking, "d5", "starbucks", { categoryId: dining.id, categorySource: "AUTO", state: "DUPLICATE" });
    const theirs = await charge(ids.other, ids.otherChecking, "o1", "starbucks", { categoryId: theirDining.id, categorySource: "AUTO" });

    expect(await removeCategory(ids.jar, dining.id, other.id)).toEqual({ ok: true, name: "Dining", to: "Other" });

    expect(await prisma.finCategory.findUnique({ where: { id: dining.id } })).toBeNull();
    const moved = await prisma.finTransaction.findMany({ where: { id: { in: [guessed.id, picked.id, ruled.id, surprise.id, duplicate.id] } } });
    expect(moved.every((r) => r.categoryId === other.id)).toBe(true);
    const by = (id: string) => moved.find((r) => r.id === id)!;
    // Each keeps how it was set: Other took Dining's key, so a guess still guesses there.
    expect(by(guessed.id).categorySource).toBe("AUTO");
    expect(by(picked.id).categorySource).toBe("PERSON");
    expect(by(ruled.id).categorySource).toBe("RULE");
    expect(by(surprise.id)).toMatchObject({ giftById: ids.dad, giftHiddenFrom: [ids.mom] });
    expect((await prisma.categoryRule.findUniqueOrThrow({ where: { jarId_key: { jarId: ids.jar, key: "chipotle" } } })).categoryId).toBe(other.id);
    // Other wasn't saving up: it takes Dining's budget and its saving up, and Dining's key.
    expect(await cat(ids.jar, "other")).toMatchObject({ budgetCents: 20000, rollover: true, rolloverFrom: today.slice(0, 7), absorbedKeys: ["dining"] });

    // The tidy-up keeps them there, and a new coffee charge is guessed into Other too.
    const fresh = await charge(ids.jar, ids.checking, "d6", "starbucks");
    await categorizeJar(prisma, ids.jar);
    const after = await prisma.finTransaction.findMany({ where: { id: { in: [guessed.id, ruled.id, fresh.id] } }, select: { categoryId: true, categorySource: true } });
    expect(after.every((r) => r.categoryId === other.id)).toBe(true);
    expect(after.filter((r) => r.categorySource === "AUTO")).toHaveLength(2);

    // The other jar's Dining, its charge and its rule are untouched.
    expect(await prisma.finCategory.findUnique({ where: { id: theirDining.id } })).not.toBeNull();
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: theirs.id } })).categoryId).toBe(theirDining.id);
    expect((await prisma.categoryRule.findUniqueOrThrow({ where: { id: theirRule.id } })).categoryId).toBe(theirDining.id);
  });

  test("both budgets add up; a target that's saving up keeps its own rollover and goal", async () => {
    const [fun, shopping] = await Promise.all([cat(ids.jar, "fun"), cat(ids.jar, "shopping")]);
    await prisma.finCategory.update({ where: { id: fun.id }, data: { budgetCents: 5000, goalCents: 1, goalMonth: dayFrom(60).slice(0, 7), rollover: true, rolloverFrom: "2026-01" } });
    await prisma.finCategory.update({ where: { id: shopping.id }, data: { budgetCents: 30000, rollover: true, rolloverFrom: "2026-03", goalCents: 90000, goalMonth: "2027-06" } });
    expect(await removeCategory(ids.jar, fun.id, shopping.id)).toEqual({ ok: true, name: "Fun", to: "Shopping" });
    expect(await cat(ids.jar, "shopping")).toMatchObject({ budgetCents: 35000, rollover: true, rolloverFrom: "2026-03", goalCents: 90000, goalMonth: "2027-06", absorbedKeys: ["fun"] });
  });

  test("grocery trips follow Groceries into the category it was removed into", async () => {
    const groceries = await cat(ids.jar, "groceries");
    expect(await addCategory(ids.jar, { name: "Food", emoji: "🍽️", kind: "SPEND" })).toMatchObject({ ok: true });
    const food = await prisma.finCategory.findFirstOrThrow({ where: { jarId: ids.jar, name: "Food" } });
    expect(await removeCategory(ids.jar, groceries.id, food.id)).toMatchObject({ ok: true });
    expect((await prisma.finCategory.findUniqueOrThrow({ where: { id: food.id } })).absorbedKeys).toEqual(["groceries"]);

    const NOW = new Date(`${today}T18:00:00Z`);
    const trip = await prisma.purchase.create({ data: { householdId: ids.h, purchasedById: ids.dad, purchasedAt: new Date(`${today}T15:00:00Z`) } });
    const groceryRun = await charge(ids.jar, ids.checking, "g1", "kroger", { amountCents: -8214, categoryId: food.id, categorySource: "AUTO" });
    expect(await linkGroceries(prisma, ids.jar, NOW)).toBe(1);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: groceryRun.id } })).purchaseId).toBe(trip.id);
    // And a new grocery charge is guessed into Food.
    const another = await charge(ids.jar, ids.checking, "g2", "aldi");
    await categorizeJar(prisma, ids.jar);
    expect((await prisma.finTransaction.findUniqueOrThrow({ where: { id: another.id } })).categoryId).toBe(food.id);
  });

  test("a removal and the tidy-up at the same moment never leave a charge pointing nowhere", async () => {
    const [travel, other] = await Promise.all([cat(ids.jar, "travel"), cat(ids.jar, "other")]);
    const rides = await Promise.all(Array.from({ length: 30 }, (_, i) => charge(ids.jar, ids.checking, `ride-${i}`, "lyft")));
    await Promise.all([categorizeJar(prisma, ids.jar), removeCategory(ids.jar, travel.id, other.id), categorizeJar(prisma, ids.jar)]);
    const after = await prisma.finTransaction.findMany({ where: { id: { in: rides.map((r) => r.id) } }, select: { categoryId: true } });
    expect(after.every((r) => r.categoryId === other.id)).toBe(true);
  });

  test("built-ins, a different kind and another jar's categories are refused", async () => {
    const [other, income, transfers, kids, health, theirOther] = await Promise.all([
      cat(ids.jar, "other"),
      cat(ids.jar, "income"),
      cat(ids.jar, "transfers"),
      cat(ids.jar, "kids"),
      cat(ids.jar, "health"),
      cat(ids.other, "other"),
    ]);
    expect(await removeCategory(ids.jar, other.id, health.id)).toEqual({ ok: false, error: "Other can be renamed but not removed: the app counts on it." });
    expect(await removeCategory(ids.jar, income.id, other.id)).toMatchObject({ ok: false });
    expect(await removeCategory(ids.jar, transfers.id, other.id)).toMatchObject({ ok: false });
    expect(await removeCategory(ids.jar, kids.id, income.id)).toEqual({ ok: false, error: "Pick another category of the same kind for its charges." });
    expect(await removeCategory(ids.jar, kids.id, theirOther.id)).toMatchObject({ ok: false });
    expect(await removeCategory(ids.jar, theirOther.id, other.id)).toMatchObject({ ok: false });
    expect(await prisma.finCategory.count({ where: { id: { in: [other.id, income.id, transfers.id, kids.id, theirOther.id] } } })).toBe(5);
  });

  test("names are unique in the jar ignoring case; a new one goes before Other with its own key", async () => {
    const car = await cat(ids.jar, "car");
    expect(await renameCategory(ids.jar, car.id, { name: "OTHER", emoji: null })).toEqual({ ok: false, error: "This jar already has a category called OTHER." });
    expect(await renameCategory(ids.jar, car.id, { name: "gas & CAR", emoji: "⛽" })).toMatchObject({ ok: true, changed: true });
    expect(await renameCategory(ids.jar, car.id, { name: "gas & CAR", emoji: "⛽" })).toMatchObject({ ok: true, changed: false });
    expect(await cat(ids.jar, "car")).toMatchObject({ name: "gas & CAR" });
    // The same name in another jar is fine.
    const theirGroceries = await cat(ids.other, "groceries");
    expect(await renameCategory(ids.other, theirGroceries.id, { name: "Other stuff", emoji: null })).toMatchObject({ ok: true });
    expect(await renameCategory(ids.jar, theirGroceries.id, { name: "Mine now", emoji: null })).toMatchObject({ ok: false });

    const both = await Promise.all([addCategory(ids.jar, { name: "Pets", emoji: "🐾", kind: "SPEND" }), addCategory(ids.jar, { name: "pets", emoji: null, kind: "SPEND" })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await addCategory(ids.jar, { name: "Side gig", emoji: "💼", kind: "INCOME" })).toMatchObject({ ok: true });

    const order = await prisma.finCategory.findMany({ where: { jarId: ids.jar }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true, kind: true, sortOrder: true } });
    const at = (name: string) => order.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    expect(at("pets")).toBe(at("Other") - 1);
    expect(at("Side gig")).toBe(at("Income") + 1);
    expect(order.at(-1)?.key).toBe("transfers");
    expect(new Set(order.map((c) => c.sortOrder)).size).toBe(order.length);
    expect(order.find((c) => c.name.toLowerCase() === "pets")!.key).toMatch(/^pets-[a-z0-9]{6}$/);
  });

  test("the actions are members-only and write the jar's history", async () => {
    const actions = await import("@/app/(app)/finances/[jarId]/settings/categories/actions");
    const [home, other, health] = await Promise.all([cat(ids.jar, "home"), cat(ids.jar, "other"), cat(ids.jar, "health")]);
    await charge(ids.jar, ids.checking, "h1", "pharmacy", { categoryId: health.id, categorySource: "PERSON" });

    await as(ids.outsider);
    await expect(actions.renameCategory(ids.jar, home.id, {}, form({ name: "House", emoji: "" }))).rejects.toThrow("NOT_FOUND");
    await expect(actions.removeCategory(ids.jar, home.id, {}, form({ to: other.id }))).rejects.toThrow("NOT_FOUND");
    await expect(actions.addCategory(ids.jar, {}, form({ name: "Boats", emoji: "", kind: "SPEND" }))).rejects.toThrow("NOT_FOUND");

    await as(ids.mom);
    expect(await actions.renameCategory(ids.jar, home.id, {}, form({ name: "x".repeat(41), emoji: "" }))).toEqual({ error: "Keep the name to 40 characters." });
    expect(await actions.addCategory(ids.jar, {}, form({ name: "Boats", emoji: "", kind: "TRANSFER" }))).toEqual({ error: "Pick Spending or Income." });
    expect(await actions.renameCategory(ids.jar, home.id, {}, form({ name: "House", emoji: "🏡" }))).toEqual({ ok: "Saved." });
    expect(await actions.addCategory(ids.jar, {}, form({ name: "Garden", emoji: "🌱", kind: "SPEND" }))).toEqual({ ok: "Added Garden." });
    expect(await actions.removeCategory(ids.jar, health.id, {}, form({ to: other.id }))).toEqual({ ok: "Removed Health." });
    expect(await actions.removeCategory(ids.jar, other.id, {}, form({ to: home.id }))).toEqual({ error: "Other can be renamed but not removed: the app counts on it." });

    const lines = (await jarHistory(ids.jar, ids.dad, today)).map((l) => l.text);
    expect(lines).toEqual(expect.arrayContaining(["Mom renamed Home to House", "Mom added 🌱 Garden", "Mom removed Health (moved its charges to Other)"]));
    const kinds = await prisma.jarEvent.findMany({ where: { jarId: ids.jar }, select: { kind: true } });
    expect(kinds.map((k) => k.kind).sort()).toEqual(["CATEGORY_ADDED", "CATEGORY_REMOVED", "CATEGORY_RENAMED"]);
    // Nothing went in the other jar's history.
    expect(await prisma.jarEvent.count({ where: { jarId: ids.other } })).toBe(0);
  });
});
