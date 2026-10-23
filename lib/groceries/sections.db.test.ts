import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureStartingSections } from "./queries";
import { addSection, guessedSectionId, moveSectionStep, removeSection, renameSection } from "./section-edits";

/**
 * Phase 37's Store sections against a real database: `npm run test:db`. Guesses follow a
 * starting section through a rename and stop after it's removed; names are unique per
 * household ignoring case (two phones at once included); moving rewrites a tidy order;
 * removing moves the items first, in its own household only, and keeps the last section;
 * kids can't change any of it.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown> };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile };
});

describe.skipIf(!RUN)("store sections (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", other: "", mom: "", kid: "" };
  const t = Date.now();

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-sections-${t}` } });
    const other = await prisma.household.create({ data: { name: `e2e-sections-other-${t}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, kid: kid.id });
    await ensureStartingSections(h.id);
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const section = (householdId: string, starterKey: string) => prisma.productGroup.findUniqueOrThrow({ where: { householdId_starterKey: { householdId, starterKey } } });
  const order = async (householdId: string) =>
    (await prisma.productGroup.findMany({ where: { householdId }, orderBy: { sortOrder: "asc" }, select: { name: true, sortOrder: true } })).map((s) => `${s.sortOrder}:${s.name}`);
  const product = (householdId: string, name: string, groupId: string | null) =>
    prisma.product.create({ data: { householdId, name, nameKey: `${name.toLowerCase()}-${t}`, groupId } });
  const as = async (personId: string) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
  };
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  test("a new item's guess finds its starting section after a rename, and not after a removal", async () => {
    const pet = await section(ids.h, "pet");
    expect(await renameSection(ids.h, pet.id, { name: "Dog stuff", emoji: "🐶" })).toEqual({ ok: true, name: "Dog stuff" });
    expect(await guessedSectionId(ids.h, "Dog food")).toBe(pet.id);

    // Through the add box, as a grown-up types it.
    const { addItem } = await import("@/app/(app)/groceries/actions");
    await as(ids.mom);
    await addItem({ name: "Kitten chow" });
    expect((await prisma.product.findFirstOrThrow({ where: { householdId: ids.h, name: "Kitten chow" } })).groupId).toBe(pet.id);

    // Another household's sections are never guessed into.
    expect(await guessedSectionId(ids.other, "Dog food")).toBeNull();

    expect(await removeSection(ids.h, pet.id, null)).toMatchObject({ ok: true, name: "Dog stuff", moved: 1, to: null });
    expect(await guessedSectionId(ids.h, "Dog food")).toBeNull();
    expect((await prisma.product.findFirstOrThrow({ where: { householdId: ids.h, name: "Kitten chow" } })).groupId).toBeNull();

    // Added back by its starting name, it's the starting section again.
    expect(await addSection(ids.h, { name: "pet", emoji: null })).toEqual({ ok: true, name: "pet" });
    const back = await section(ids.h, "pet");
    expect(await guessedSectionId(ids.h, "Dog treats")).toBe(back.id);
  });

  test("names are unique in the household ignoring case, even from two phones at once", async () => {
    const dairy = await section(ids.h, "dairy");
    expect(await renameSection(ids.h, dairy.id, { name: "produce", emoji: "🥛" })).toEqual({ ok: false, error: "There's already a section called produce." });
    expect(await renameSection(ids.h, dairy.id, { name: "DAIRY", emoji: null })).toEqual({ ok: true, name: "DAIRY" });
    expect(await prisma.productGroup.findUniqueOrThrow({ where: { id: dairy.id } })).toMatchObject({ name: "DAIRY", emoji: null, starterKey: "dairy" });
    expect(await addSection(ids.h, { name: "Frozen", emoji: null })).toMatchObject({ ok: false });

    const both = await Promise.all([addSection(ids.h, { name: "Deli", emoji: "🥪" }), addSection(ids.h, { name: "deli", emoji: null })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.productGroup.count({ where: { householdId: ids.h, name: { in: ["Deli", "deli"] } } })).toBe(1);

    // Another household's names are its own.
    expect(await addSection(ids.other, { name: "Deli", emoji: null })).toEqual({ ok: true, name: "Deli" });
    // Renaming someone else's section reads as gone.
    expect(await renameSection(ids.other, dairy.id, { name: "Milk", emoji: null })).toMatchObject({ ok: false });
    expect((await prisma.productGroup.findUniqueOrThrow({ where: { id: dairy.id } })).name).toBe("DAIRY");
  });

  test("moving swaps neighbors and writes a tidy order; the ends stay put", async () => {
    // Two sections sharing an order (an old backup's default 0) come out numbered.
    await prisma.productGroup.updateMany({ where: { householdId: ids.h }, data: { sortOrder: 0 } });
    const before = await prisma.productGroup.findMany({ where: { householdId: ids.h }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    expect(await moveSectionStep(ids.h, before[0].id, "up")).toBe(false);
    expect(await moveSectionStep(ids.h, before.at(-1)!.id, "down")).toBe(false);
    expect(await moveSectionStep(ids.h, before[1].id, "up")).toBe(true);
    const names = before.map((s) => s.name);
    [names[0], names[1]] = [names[1], names[0]];
    expect(await order(ids.h)).toEqual(names.map((n, i) => `${i}:${n}`));
    // Not this household's section: nothing moves.
    const theirs = await prisma.productGroup.findFirstOrThrow({ where: { householdId: ids.other } });
    expect(await moveSectionStep(ids.h, theirs.id, "up")).toBe(false);
  });

  test("removing moves its items first, stays in the household, and keeps the last section", async () => {
    const [snacks, produce] = await Promise.all([section(ids.h, "snacks"), section(ids.h, "produce")]);
    await Promise.all(["Pretzels", "Popcorn", "Crackers"].map((n) => product(ids.h, n, snacks.id)));
    const theirs = await prisma.productGroup.findFirstOrThrow({ where: { householdId: ids.other } });

    // A target from another household, or a section that isn't theirs, does nothing.
    expect(await removeSection(ids.h, snacks.id, theirs.id)).toEqual({ ok: false, error: "That section isn't here anymore. Pick another one." });
    expect(await removeSection(ids.other, snacks.id, null)).toMatchObject({ ok: false });
    expect(await removeSection(ids.h, snacks.id, snacks.id)).toMatchObject({ ok: false });
    expect(await prisma.product.count({ where: { groupId: snacks.id } })).toBe(3);

    expect(await removeSection(ids.h, snacks.id, produce.id)).toEqual({ ok: true, name: "Snacks", moved: 3, to: "Produce" });
    expect(await prisma.productGroup.findUnique({ where: { id: snacks.id } })).toBeNull();
    expect(await prisma.product.count({ where: { householdId: ids.h, name: { in: ["Pretzels", "Popcorn", "Crackers"] }, groupId: produce.id } })).toBe(3);

    // The other household is down to one section ("Deli", added above): it stays.
    expect(await removeSection(ids.other, theirs.id, null)).toEqual({ ok: false, error: "Keep at least one section. Rename this one instead." });
  });

  test("kids can't change sections; the actions check the form", async () => {
    const actions = await import("@/app/(app)/groceries/sections/actions");
    const produce = await section(ids.h, "produce");
    await as(ids.kid);
    await expect(actions.renameSection(produce.id, {}, form({ name: "Fruit", emoji: "" }))).rejects.toThrow("Only adults can do that");
    await expect(actions.removeSection(produce.id, {}, form({ to: "" }))).rejects.toThrow("Only adults can do that");
    await expect(actions.addSection({}, form({ name: "Toys", emoji: "" }))).rejects.toThrow("Only adults can do that");
    await expect(actions.moveSection(produce.id, "down")).rejects.toThrow("Only adults can do that");

    await as(ids.mom);
    expect(await actions.renameSection(produce.id, {}, form({ name: "  ", emoji: "" }))).toEqual({ error: "Give it a name." });
    expect(await actions.renameSection(produce.id, {}, form({ name: "Fruit & veg", emoji: "two words" }))).toEqual({ error: "Pick one emoji, or leave it empty." });
    expect(await actions.renameSection(produce.id, {}, form({ name: " Fruit  & veg ", emoji: "🍎" }))).toEqual({ ok: "Saved." });
    expect(await prisma.productGroup.findUniqueOrThrow({ where: { id: produce.id } })).toMatchObject({ name: "Fruit & veg", emoji: "🍎", starterKey: "produce" });
    expect(await actions.addSection({}, form({ name: "Flowers", emoji: "💐" }))).toMatchObject({ ok: expect.stringContaining("Added Flowers") });
    expect((await order(ids.h)).at(-1)).toMatch(/:Flowers$/);
  });
});
