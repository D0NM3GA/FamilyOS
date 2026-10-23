import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPointsBalance } from "@/lib/tasks/queries";
import { adjustStickers, getStickerHistory } from "./ledger";

/**
 * Bonus and take-back against a real database: `npm run test:db`. Skipped by plain
 * `npm test`. Throwaway households, deleted afterwards.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("sticker bonus and take-back (database)", () => {
  const ids = {} as { h: string; other: string; mom: string; kid: string; outsider: string };
  type Role = "ADULT" | "KID" | "ADMIN";
  const actor = (id: string, role: Role, householdId = ids.h) => ({ id, householdId, role, firstName: "Mom" });

  beforeAll(async () => {
    const tag = Date.now();
    const h = await prisma.household.create({ data: { name: `e2e stickers ${tag}` } });
    const other = await prisma.household.create({ data: { name: `e2e stickers other ${tag}` } });
    const mom = await prisma.person.create({ data: { householdId: h.id, firstName: "Mom", isHouseholdMember: true, role: "ADULT" } });
    const kid = await prisma.person.create({ data: { householdId: h.id, firstName: "Kid", isHouseholdMember: true, role: "KID" } });
    const outsider = await prisma.person.create({ data: { householdId: other.id, firstName: "Nope", isHouseholdMember: true, role: "KID" } });
    Object.assign(ids, { h: h.id, other: other.id, mom: mom.id, kid: kid.id, outsider: outsider.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  test("a grown-up gives and takes back; it shows in the kid's history and balance", async () => {
    expect(await adjustStickers(actor(ids.mom, "ADULT"), { personId: ids.kid, delta: 10, reason: "Helped Grandma" })).toEqual({ ok: true });
    expect(await adjustStickers(actor(ids.mom, "ADULT"), { personId: ids.kid, delta: -3, reason: "Fibbed" })).toEqual({ ok: true });
    expect(await getPointsBalance(ids.kid)).toBe(7);
    expect((await prisma.notification.findMany({ where: { recipientId: ids.kid }, orderBy: { createdAt: "asc" } })).map((n) => [n.kind, n.title])).toEqual([
      ["STICKERS_ADJUSTED", "🌟 +10 stickers from Mom: Helped Grandma"],
      ["STICKERS_ADJUSTED", "Mom took back 3 stickers: Fibbed"],
    ]);
    expect((await getStickerHistory(ids.kid)).map((r) => [r.kind, r.delta, r.label])).toEqual([
      ["taken", -3, "Fibbed"],
      ["bonus", 10, "Helped Grandma"],
    ]);
  });

  test("kids, yourself, other households and silly amounts are refused", async () => {
    expect(await adjustStickers(actor(ids.kid, "KID"), { personId: ids.kid, delta: 50, reason: "x" })).toHaveProperty("error");
    expect(await adjustStickers(actor(ids.mom, "ADULT"), { personId: ids.mom, delta: 5, reason: "me" })).toHaveProperty("error");
    expect(await adjustStickers(actor(ids.mom, "ADULT"), { personId: ids.outsider, delta: 5, reason: "x" })).toHaveProperty("error");
    for (const delta of [0, 501, -501, 1.5]) {
      expect(await adjustStickers(actor(ids.mom, "ADULT"), { personId: ids.kid, delta, reason: "x" })).toHaveProperty("error");
    }
    expect(await getPointsBalance(ids.outsider)).toBe(0);
    expect(await getPointsBalance(ids.kid)).toBe(7);
  });
});
