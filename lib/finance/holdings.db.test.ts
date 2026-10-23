import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { addHolding, readBalanceDays, readHoldings, removeHolding, removeHoldingValue, setHoldingValue } from "./holdings";

/**
 * Phase 34's hand-valued things and balance history against a real database: `npm run test:db`.
 * Every write is scoped by the jar the caller passed requireJar for, so another jar's holding
 * id matches nothing.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("net worth holdings (database)", () => {
  const ids = { h: "", ours: "", theirs: "", account: "" };
  const d = (day: string) => new Date(`${day}T00:00:00Z`);

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e holdings ${Date.now()}` } });
    const [ours, theirs] = await Promise.all([
      prisma.moneyJar.create({ data: { householdId: h.id, name: "Family" } }),
      prisma.moneyJar.create({ data: { householdId: h.id, name: "Grandma's" } }),
    ]);
    const account = await prisma.finAccount.create({ data: { jarId: ours.id, source: "SIMPLEFIN", externalId: "a", name: "Checking" } });
    Object.assign(ids, { h: h.id, ours: ours.id, theirs: theirs.id, account: account.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  test("add, value again (same day replaces), take one off, remove; the last value stays", async () => {
    expect(await addHolding(ids.ours, { name: "House", kind: "HOME", valueCents: 30_000_000, valuedOn: "2019-06-01" })).toEqual({ ok: true, name: "House", kind: "HOME" });
    const [house] = await readHoldings(prisma, ids.ours);
    expect(await setHoldingValue(ids.ours, house.id, { valueCents: 44_000_000, valuedOn: "2026-10-01" })).toMatchObject({ ok: true });
    expect(await setHoldingValue(ids.ours, house.id, { valueCents: 45_000_000, valuedOn: "2026-10-01" })).toMatchObject({ ok: true });
    expect((await readHoldings(prisma, ids.ours))[0].values).toEqual([
      { day: "2019-06-01", cents: 30_000_000 },
      { day: "2026-10-01", cents: 45_000_000 },
    ]);

    expect(await removeHoldingValue(ids.ours, house.id, "2019-06-01")).toMatchObject({ ok: true });
    expect(await removeHoldingValue(ids.ours, house.id, "2026-10-01")).toEqual({ ok: false, error: "That's its only value. Remove the whole thing instead." });
    expect(await removeHolding(ids.ours, house.id)).toMatchObject({ ok: true, name: "House" });
    expect(await readHoldings(prisma, ids.ours)).toEqual([]);
  });

  test("two take-offs at once still leave one value (one write at a time per holding)", async () => {
    await addHolding(ids.ours, { name: "Boat", kind: "OTHER_ASSET", valueCents: 500_000, valuedOn: "2025-01-01" });
    const boat = (await readHoldings(prisma, ids.ours)).find((h) => h.name === "Boat")!;
    await setHoldingValue(ids.ours, boat.id, { valueCents: 450_000, valuedOn: "2026-01-01" });
    const results = await Promise.all([removeHoldingValue(ids.ours, boat.id, "2025-01-01"), removeHoldingValue(ids.ours, boat.id, "2026-01-01")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await readHoldings(prisma, ids.ours)).find((h) => h.id === boat.id)!.values).toHaveLength(1);
    await removeHolding(ids.ours, boat.id);
  });

  test("another jar's holding can't be valued, trimmed or removed", async () => {
    await addHolding(ids.theirs, { name: "Grandma's car", kind: "VEHICLE", valueCents: 800_000, valuedOn: "2026-01-01" });
    const [car] = await readHoldings(prisma, ids.theirs);
    await setHoldingValue(ids.theirs, car.id, { valueCents: 700_000, valuedOn: "2026-09-01" });

    expect(await setHoldingValue(ids.ours, car.id, { valueCents: 1, valuedOn: "2026-10-01" })).toEqual({ ok: false, error: "That isn't here anymore." });
    expect(await removeHoldingValue(ids.ours, car.id, "2026-01-01")).toEqual({ ok: false, error: "That isn't here anymore." });
    expect(await removeHolding(ids.ours, car.id)).toEqual({ ok: false, error: "That isn't here anymore." });
    expect((await readHoldings(prisma, ids.theirs))[0].values).toHaveLength(2);
    expect(await readHoldings(prisma, ids.ours)).toEqual([]);
  });

  test("balance days: those from the window's start on, plus the newest one before it", async () => {
    await prisma.finBalanceDay.createMany({
      data: [
        { accountId: ids.account, day: d("2025-06-30"), balanceCents: 100 },
        { accountId: ids.account, day: d("2025-09-15"), balanceCents: 200 },
        { accountId: ids.account, day: d("2025-10-02"), balanceCents: 300 },
        { accountId: ids.account, day: d("2026-01-05"), balanceCents: 400 },
      ],
    });
    const days = await readBalanceDays(prisma, [ids.account, "no-such-account"], "2025-10-01");
    expect(days.get(ids.account)).toEqual([
      { day: "2025-09-15", cents: 200 },
      { day: "2025-10-02", cents: 300 },
      { day: "2026-01-05", cents: 400 },
    ]);
    expect(days.get("no-such-account")).toEqual([]);
    expect((await readBalanceDays(prisma, [], "2025-10-01")).size).toBe(0);
  });
});
