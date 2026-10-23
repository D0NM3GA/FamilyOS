import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { isDeletableContact } from "./people";

/** Who can be deleted from People, against a real database: `npm run test:db`. */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("isDeletableContact (database)", () => {
  const ids = {} as { h: string; other: string };

  beforeAll(async () => {
    const tag = Date.now();
    ids.h = (await prisma.household.create({ data: { name: `e2e people ${tag}` } })).id;
    ids.other = (await prisma.household.create({ data: { name: `e2e people other ${tag}` } })).id;
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: [ids.h, ids.other] } } });
  });

  const person = (data: { isHouseholdMember?: boolean; role?: "KID" | "ADULT" | null }, householdId = ids.h) =>
    prisma.person.create({ data: { householdId, firstName: "P", ...data } });

  test("a plain contact can go; members and other households can't", async () => {
    const contact = await person({});
    const member = await person({ isHouseholdMember: true, role: "KID" });
    const theirs = await person({}, ids.other);
    expect(await isDeletableContact(contact.id, ids.h)).toBe(true);
    expect(await isDeletableContact(member.id, ids.h)).toBe(false);
    expect(await isDeletableContact(theirs.id, ids.h)).toBe(false);
  });

  test("someone removed from the household who still has stickers or a school record stays", async () => {
    const formerWithStickers = await person({ isHouseholdMember: false });
    await prisma.pointsLedger.create({ data: { personId: formerWithStickers.id, delta: 5, reason: "Chore" } });
    const formerWithSchool = await person({ isHouseholdMember: false });
    await prisma.schoolProfile.create({ data: { personId: formerWithSchool.id, schoolName: "Acorn Hollow" } });
    expect(await isDeletableContact(formerWithStickers.id, ids.h)).toBe(false);
    expect(await isDeletableContact(formerWithSchool.id, ids.h)).toBe(false);
  });
});
