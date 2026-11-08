import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 70d against a real database (`npm run test:db`): gift ideas are for grown-ups and never
 * reach the person they're for (their page, their backup, a restore they run); the pet keeps
 * weekend hours on a no-school day from the family's or its kid's feed, unless switched off.
 */
const RUN = import.meta.env.MODE === "db";
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

describe.skipIf(!RUN)("gift ideas and no-school days (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", max: "" };
  const who = (id: string) => prisma.person.findUniqueOrThrow({ where: { id }, select: { id: true, householdId: true, role: true } });

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-gifts-${t}`, timezone: "UTC" } });
    const mk = (firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, mom, ivy, max] = await Promise.all([mk("Dad", "ADMIN"), mk("Mom", "ADULT"), mk("Ivy", "KID"), mk("Max", "KID")]);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, max: max.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("grown-ups keep ideas for others; nobody sees their own; kids see none", async () => {
    const { addGiftIdea, listGiftIdeas, setGiftGiven, removeGiftIdea } = await import("./gift-ideas");
    expect(await addGiftIdea(await who(ids.mom), ids.dad, "  Fishing   hat ")).toEqual({ ok: true });
    expect(await addGiftIdea(await who(ids.mom), ids.ivy, "Paint set")).toEqual({ ok: true });
    expect((await addGiftIdea(await who(ids.dad), ids.dad, "Something for me")).ok).toBe(false);
    expect((await addGiftIdea(await who(ids.ivy), ids.max, "Kite")).ok).toBe(false);
    expect((await listGiftIdeas(await who(ids.mom), ids.dad)).map((g) => g.text)).toEqual(["Fishing hat"]);
    expect(await listGiftIdeas(await who(ids.dad), ids.dad)).toEqual([]);
    expect(await listGiftIdeas(await who(ids.max), ids.ivy)).toEqual([]);
    const hat = await prisma.giftIdea.findFirstOrThrow({ where: { personId: ids.dad } });
    // Dad can't mark or remove his own, even by id.
    expect((await setGiftGiven(await who(ids.dad), hat.id, true)).ok).toBe(false);
    expect((await removeGiftIdea(await who(ids.dad), hat.id)).ok).toBe(false);
    expect(await setGiftGiven(await who(ids.mom), hat.id, true)).toEqual({ ok: true });
    expect((await listGiftIdeas(await who(ids.mom), ids.dad))[0].given).toBe(true);
    await setGiftGiven(await who(ids.mom), hat.id, false);
  });

  test("a backup leaves out the ideas for whoever takes it; a restore by them keeps theirs", async () => {
    const { buildBackup } = await import("./backup/build");
    const byDad = await buildBackup(ids.h, new Date(), { takenBy: ids.dad });
    expect(byDad.giftIdeas.map((g) => g.text)).toEqual(["Paint set"]);
    const byMom = await buildBackup(ids.h, new Date(), { takenBy: ids.mom });
    expect(byMom.giftIdeas.map((g) => g.text).sort()).toEqual(["Fishing hat", "Paint set"]);
  });

  test("birthday reminders count open ideas only", async () => {
    const { openGiftIdeaCounts } = await import("./gift-ideas");
    await prisma.giftIdea.create({ data: { householdId: ids.h, personId: ids.ivy, text: "Given already", givenAt: new Date() } });
    const counts = await openGiftIdeaCounts(ids.h, [ids.ivy, ids.dad, ids.max]);
    expect(counts.get(ids.ivy)).toBe(1);
    expect(counts.get(ids.dad)).toBe(1);
    expect(counts.has(ids.max)).toBe(false);
  });

  test("the pet's no-school days: the family's feed and its own kid's, not another kid's, and the switch", async () => {
    const { getCareHours } = await import("./pet/queries");
    const now = new Date(Date.UTC(2026, 10, 11, 12));
    const feed = (name: string, kidPersonId: string | null) =>
      prisma.schoolFeed.create({
        data: { householdId: ids.h, name, forFamily: !kidPersonId, ...(kidPersonId ? { kids: { create: [{ personId: kidPersonId }] } } : {}), encryptedValue: Buffer.from("x"), iv: Buffer.from("x"), authTag: Buffer.from("x"), urlHash: `${name}-${t}`, host: "school.example.com" },
      });
    const [family, ivys, maxs] = await Promise.all([feed("District", null), feed("Ivy school", ids.ivy), feed("Max school", ids.max)]);
    const allDay = (feedId: string, title: string, d: string) => ({ feedId, occurrenceKey: `${title}-${d}`, uid: title, title, startsAt: new Date(`${d}T00:00:00Z`), endsAt: new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000), allDay: true });
    await prisma.schoolFeedEvent.createMany({
      data: [allDay(family.id, "No School", "2026-11-11"), allDay(ivys.id, "Teacher Work Day", "2026-11-10"), allDay(maxs.id, "Teacher Work Day", "2026-11-09")],
    });
    const ivy = await getCareHours(ids.h, ids.ivy, now);
    expect([...(ivy.weekendDays ?? [])].sort()).toEqual(["2026-11-10", "2026-11-11"]);
    await prisma.household.update({ where: { id: ids.h }, data: { petNoSchoolDays: false } });
    expect((await getCareHours(ids.h, ids.ivy, now)).weekendDays).toBeUndefined();
    await prisma.household.update({ where: { id: ids.h }, data: { petNoSchoolDays: true } });
  });
  test("a restore by someone keeps the ideas for them, never doubles them, and says what it replaces", async () => {
    const { buildBackup } = await import("./backup/build");
    const { previewRestore, applyRestore } = await import("./backup/restore");
    const user = await prisma.user.create({ data: { id: `e2e-gifts-mom-${t}`, name: "Mom", email: `mom-gifts-${t}@example.com` } });
    // The restorer must be an admin with their own sign-in. Last test: a restore gives the others new ids.
    await prisma.person.update({ where: { id: ids.mom }, data: { authUserId: user.id, role: "ADMIN", email: user.email } });
    try {
      await prisma.giftIdea.create({ data: { householdId: ids.h, personId: ids.mom, text: "Garden gloves", addedById: ids.dad } });
      // Taken by Dad: his own ideas stay out; Mom's and Ivy's are in.
      const file = await buildBackup(ids.h, new Date(), { takenBy: ids.dad });
      expect(file.giftIdeas.map((g) => g.text).sort()).toEqual(["Garden gloves", "Given already", "Paint set"]);
      const preview = await previewRestore(ids.h, file, { takenBy: ids.mom });
      if (!preview.ok) throw new Error(preview.errors.join(" "));
      // Everything but Mom's own: Dad's hat and Ivy's two.
      expect(preview.preview.deletes["gift ideas"]).toBe(3);
      expect(preview.preview.giftNote).not.toBeNull();
      const done = await applyRestore(ids.h, ids.mom, file, { expectedPlanDigest: preview.preview.planDigest, hooks: { takenBy: ids.mom } });
      if (!done.ok) throw new Error(done.errors.join(" "));
      const after = await prisma.giftIdea.findMany({ where: { householdId: ids.h }, select: { text: true, personId: true } });
      expect(after.filter((g) => g.personId === ids.mom).map((g) => g.text)).toEqual(["Garden gloves"]);
      // Dad's hat isn't in a file he took, so it's gone: the preview's note says so.
      expect(after.map((g) => g.text).sort()).toEqual(["Garden gloves", "Given already", "Paint set"]);
    } finally {
      await prisma.person.update({ where: { id: ids.mom }, data: { authUserId: null } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

});
