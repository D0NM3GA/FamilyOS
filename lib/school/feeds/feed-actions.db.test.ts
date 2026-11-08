import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 70f against a real database (`npm run test:db`): who a calendar is for can only be set to this
 * household's kids, never on another household's calendar; adding the same calendar for a second kid
 * joins them to it.
 */
const RUN = import.meta.env.MODE === "db";
const who = { admin: null as null | { id: string; householdId: string } };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/app-guard", () => ({ assertAppOn: async () => {}, requireAppOn: async () => {} }));
vi.mock("@/lib/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/authz")>()), requireAdmin: async () => who.admin }));

describe.skipIf(!RUN)("school calendar actions (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", other: "", dad: "", ivy: "", max: "", mom: "", stranger: "", feed: "", theirs: "" };
  const url = "https://school.example.com/calendar.ics";

  beforeAll(async () => {
    const { feedUrlHash, normalizeFeedUrl } = await import("./url");
    const norm = normalizeFeedUrl(url);
    if (!norm.ok) throw new Error("bad url");
    const [h, other] = await Promise.all([prisma.household.create({ data: { name: `e2e-feed-actions-${t}` } }), prisma.household.create({ data: { name: `e2e-feed-actions-other-${t}` } })]);
    const mk = (householdId: string, firstName: string, role: "ADMIN" | "ADULT" | "KID") => prisma.person.create({ data: { householdId, firstName, role, isHouseholdMember: true } });
    const [dad, ivy, max, mom, stranger] = await Promise.all([mk(h.id, "Dad", "ADMIN"), mk(h.id, "Ivy", "KID"), mk(h.id, "Max", "KID"), mk(h.id, "Mom", "ADULT"), mk(other.id, "Example", "KID")]);
    const feed = (householdId: string, name: string, urlHash: string, data: Record<string, unknown>) =>
      prisma.schoolFeed.create({ data: { householdId, name, encryptedValue: Buffer.from("x"), iv: Buffer.from("x"), authTag: Buffer.from("x"), urlHash, host: "school.example.com", ...data } });
    const f = await feed(h.id, "Elementary", feedUrlHash(norm.url), { kids: { create: [{ personId: ivy.id }] } });
    const theirs = await feed(other.id, "Theirs", `theirs-${t}`, { forFamily: true });
    Object.assign(ids, { h: h.id, other: other.id, dad: dad.id, ivy: ivy.id, max: max.id, mom: mom.id, stranger: stranger.id, feed: f.id, theirs: theirs.id });
    who.admin = { id: dad.id, householdId: h.id };
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const kidsOf = async (feedId: string) => (await prisma.schoolFeedKid.findMany({ where: { feedId }, select: { personId: true } })).map((k) => k.personId).sort();

  test("the same calendar for a second kid joins them; again for the same kid says so", async () => {
    const { addFeed } = await import("@/app/(app)/school/feeds/actions");
    const form = (kid: string) => {
      const fd = new FormData();
      fd.set("name", "Elementary");
      fd.set("url", url);
      fd.set("kidPersonId", kid);
      return fd;
    };
    expect((await addFeed({}, form(ids.max))).notice).toMatch(/for them too/);
    expect(await kidsOf(ids.feed)).toEqual([ids.ivy, ids.max].sort());
    expect((await addFeed({}, form(ids.max))).error).toMatch(/already added for them/);
    expect(await prisma.schoolFeed.count({ where: { householdId: ids.h } })).toBe(1);
  });

  test("who it's for: only this household's kids, never a grown-up; another household's calendar is untouched", async () => {
    const { setFeedWho } = await import("@/app/(app)/school/feeds/actions");
    const fd = new FormData();
    for (const k of [ids.ivy, ids.mom, ids.stranger]) fd.append("kid", k);
    await setFeedWho(ids.feed, fd);
    expect(await kidsOf(ids.feed)).toEqual([ids.ivy]);
    await setFeedWho(ids.theirs, fd);
    expect(await kidsOf(ids.theirs)).toEqual([]);
    expect((await prisma.schoolFeed.findUniqueOrThrow({ where: { id: ids.theirs } })).forFamily).toBe(true);
  });
});
