import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 70f against a real database (`npm run test:db`): a feed for two kids shows to each of them
 * and not a third; a feed whose last kid is deleted doesn't widen to the family; the same event in
 * two feeds shows once on School and the calendar, for every kid it's for.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("school feeds for several kids (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", ivy: "", max: "", zoe: "" };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const viewer = (id: string) => prisma.person.findUniqueOrThrow({ where: { id }, select: { id: true, householdId: true, role: true } });

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-feed-kids-${t}`, timezone: "UTC" } });
    const mk = (firstName: string, role: "ADMIN" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, ivy, max, zoe] = await Promise.all([mk("Dad", "ADMIN"), mk("Ivy", "KID"), mk("Max", "KID"), mk("Zoe", "KID")]);
    Object.assign(ids, { h: h.id, dad: dad.id, ivy: ivy.id, max: max.id, zoe: zoe.id });
    const feed = (name: string, data: Record<string, unknown>) =>
      prisma.schoolFeed.create({ data: { householdId: h.id, name, encryptedValue: Buffer.from("x"), iv: Buffer.from("x"), authTag: Buffer.from("x"), urlHash: `${name}-${t}`, host: "school.example.com", ...data } });
    const shared = await feed("Elementary", { kids: { create: [{ personId: ivy.id }, { personId: max.id }] } });
    const district = await feed("District", { forFamily: true });
    const zoes = await feed("Middle school", { kids: { create: [{ personId: zoe.id }] } });
    const ev = (feedId: string, title: string) => ({ feedId, occurrenceKey: `${title}-${feedId}`, uid: title, title, startsAt: today, endsAt: tomorrow, allDay: true });
    await prisma.schoolFeedEvent.createMany({ data: [ev(shared.id, "Book Fair"), ev(district.id, "Board Meeting"), ev(zoes.id, "Board Meeting"), ev(zoes.id, "Zoe only")] });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const titles = async (id: string) => {
    const { getUpcomingSchoolEvents } = await import("../queries");
    return (await getUpcomingSchoolEvents(await viewer(id), { days: 1, timeZone: "UTC" })).map((e) => `${e.title}|${e.who}`).sort();
  };

  test("a feed for two kids shows to each, not a third; one event in two feeds shows once", async () => {
    expect(await titles(ids.ivy)).toEqual(["Board Meeting|District", "Book Fair|Ivy & Max"]);
    expect(await titles(ids.max)).toEqual(["Board Meeting|District", "Book Fair|Ivy & Max"]);
    expect(await titles(ids.zoe)).toEqual(["Board Meeting|District", "Zoe only|Zoe"]);
    expect(await titles(ids.dad)).toEqual(["Board Meeting|District", "Book Fair|Ivy & Max", "Zoe only|Zoe"]);
  });

  test("the calendar folds the same way and knows every kid", async () => {
    const { loadSchoolEvents } = await import("@/lib/calendar/sources");
    const rows = await loadSchoolEvents(await viewer(ids.dad), new Date(today.getTime() - 86_400_000), new Date(today.getTime() + 2 * 86_400_000), "UTC");
    const fair = rows.find((r) => r.title === "Book Fair")!;
    expect(fair).toMatchObject({ who: "Ivy & Max", studentId: null });
    expect(fair.whoIds.sort()).toEqual([ids.ivy, ids.max].sort());
    expect(rows.filter((r) => r.title === "Board Meeting")).toHaveLength(1);
  });

  test("a feed whose last kid is deleted shows to nobody but the grown-ups", async () => {
    await prisma.person.delete({ where: { id: ids.zoe } });
    expect(await titles(ids.ivy)).not.toContain("Zoe only|Nobody's yet");
    const { getUpcomingSchoolEvents } = await import("../queries");
    const all = await getUpcomingSchoolEvents(await viewer(ids.dad), { days: 1, timeZone: "UTC" });
    expect(all.find((e) => e.title === "Zoe only")?.who).toBe("Middle school");
  });
});
