import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 53 against a real database: `npm run test:db`. An account left out of a jar keeps its
 * rows, marked, out of every total; the sync stops bringing anything from it; bringing it back
 * restores its rows and the next sync catches up. Another jar's account can't be touched.
 */
const RUN = import.meta.env.MODE === "db";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

describe.skipIf(!RUN)("left-out accounts (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", jar: "", other: "", conn: "" };
  const t = Date.now();
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
  let cardRows = [{ id: "C1", posted: day("2025-10-03"), amount: "-20.00", description: "SOMEONE'S OWN CARD" }];
  const fetchFn = vi.fn(async () =>
    Response.json({
      errors: [],
      accounts: [
        { id: "A1", name: "Checking", currency: "USD", balance: "500.00", org: { name: "Bank" }, transactions: [{ id: "T1", posted: day("2025-10-03"), amount: "-12.00", description: "GROCERY" }] },
        { id: "A2", name: "Card", currency: "USD", balance: "-20.00", org: { name: "Bank" }, transactions: cardRows },
      ],
    }),
  ) as unknown as typeof fetch;
  const now = new Date("2025-10-06T12:00:00Z");

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-leftout-${t}` } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const other = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Other", members: { create: [{ personId: dad.id }] } } });
    const { saveConnection, syncConnection } = await import("./sync");
    const conn = await saveConnection(jar.id, "SIMPLEFIN", "https://u:p@bridge.simplefin.org/simplefin", dad.id);
    await syncConnection(conn.id, { fetchFn, now });
    Object.assign(ids, { h: h.id, dad: dad.id, jar: jar.id, other: other.id, conn: conn.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const card = () => prisma.finAccount.findFirstOrThrow({ where: { jarId: ids.jar, externalId: "A2" } });
  const states = async () =>
    (await prisma.finTransaction.findMany({ where: { jarId: ids.jar }, select: { externalId: true, state: true }, orderBy: { externalId: "asc" } })).map((r) => `${r.externalId}:${r.state}`);

  test("leaving an account out keeps its rows, out of the totals, and the sync stops bringing it in", async () => {
    const { setAccountLeftOut, leftOutAccountIds } = await import("./left-out");
    const { syncConnection } = await import("./sync");
    const { activityWhere } = await import("./activity");
    const a2 = await card();
    await prisma.finAccount.update({ where: { id: a2.id }, data: { spending: true } });

    expect(await setAccountLeftOut(ids.jar, a2.id, true)).toBe(true);
    expect(await states()).toEqual(["C1:IGNORED", "T1:ACTIVE"]);
    expect((await card()).spending).toBe(false);
    expect([...(await leftOutAccountIds(ids.jar))]).toEqual([a2.id]);
    // Twice is the same as once.
    await setAccountLeftOut(ids.jar, a2.id, true);
    expect((await prisma.jarConnection.findUniqueOrThrow({ where: { id: ids.conn } })).excludedExternalIds).toEqual(["A2"]);

    // Activity lists it, marked; the spreadsheet and the counts don't.
    const listed = (leftOut: boolean) => prisma.finTransaction.count({ where: activityWhere(ids.jar, ids.dad, "2025-10-06", { month: "2025-10", leftOut }) });
    expect(await listed(true)).toBe(2);
    expect(await listed(false)).toBe(1);

    cardRows = [...cardRows, { id: "C2", posted: day("2025-10-05"), amount: "-30.00", description: "SOMEONE'S OWN CARD" }];
    await syncConnection(ids.conn, { fetchFn, now });
    expect(await states()).toEqual(["C1:IGNORED", "T1:ACTIVE"]);
  });

  test("bringing it back restores its rows, and the next sync catches up", async () => {
    const { setAccountLeftOut, leftOutAccountIds } = await import("./left-out");
    const { syncConnection } = await import("./sync");
    expect(await setAccountLeftOut(ids.jar, (await card()).id, false)).toBe(true);
    expect(await states()).toEqual(["C1:ACTIVE", "T1:ACTIVE"]);
    expect((await leftOutAccountIds(ids.jar)).size).toBe(0);
    await syncConnection(ids.conn, { fetchFn, now });
    expect(await states()).toEqual(["C1:ACTIVE", "C2:ACTIVE", "T1:ACTIVE"]);
  });

  test("another jar's account, or a jar with no bank feed, changes nothing", async () => {
    const { setAccountLeftOut } = await import("./left-out");
    const a2 = await card();
    expect(await setAccountLeftOut(ids.other, a2.id, true)).toBe(false);
    const manual = await prisma.finAccount.create({ data: { jarId: ids.other, source: "MANUAL", externalId: `m-${t}`, name: "Old statements" } });
    expect(await setAccountLeftOut(ids.other, manual.id, true)).toBe(false);
    expect(await states()).toEqual(["C1:ACTIVE", "C2:ACTIVE", "T1:ACTIVE"]);
  });
});
