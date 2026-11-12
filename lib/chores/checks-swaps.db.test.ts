import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { atMidnight, addDays } from "@/lib/tasks/schedule";

/**
 * Phase 70c against a real database (`npm run test:db`): a chore a grown-up checks pays only on the
 * OK, once; Not yet and a kid's undo take nothing back; swaps move both chores only while each is as
 * asked, never twice, and lapse when a grown-up changes a chore.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("chore checks and swaps (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", mom: "", ivy: "", max: "", checked: "", plain: "" };
  const today = atMidnight(new Date());
  const kid = (id: string) => ({ id, householdId: ids.h, adult: false });
  const grownUp = () => ({ id: ids.mom, householdId: ids.h, adult: true });
  const swapper = (id: string, role: "KID" | "ADULT" = "KID") => ({ id, householdId: ids.h, role });
  const instance = (definitionId: string, assignedToId: string, dayOffset = 0) =>
    prisma.taskInstance.create({ data: { definitionId, assignedToId, dueDate: addDays(today, dayOffset) }, select: { id: true } });

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-chore-checks-${t}` } });
    const mk = (firstName: string, role: "ADULT" | "KID") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [mom, ivy, max] = await Promise.all([mk("Mom", "ADULT"), mk("Ivy", "KID"), mk("Max", "KID")]);
    const def = (title: string, needsCheck: boolean) =>
      prisma.taskDefinition.create({ data: { householdId: h.id, domain: "CHORE", title, frequencyType: "ONCE", startDate: today, points: 5, needsCheck } });
    const [checked, plain] = await Promise.all([def("Clean room", true), def("Feed the cat", false)]);
    Object.assign(ids, { h: h.id, mom: mom.id, ivy: ivy.id, max: max.id, checked: checked.id, plain: plain.id });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const ledger = (instanceId: string) => prisma.pointsLedger.count({ where: { instanceId } });

  test("a kid's tick waits; only a grown-up's OK pays, once", async () => {
    const { completeChore, checkChore } = await import("@/lib/tasks/chore-cores");
    const i = await instance(ids.checked, ids.ivy);
    expect(await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), i.id))).toEqual({ ok: true, waiting: true });
    const waiting = await prisma.taskInstance.findUniqueOrThrow({ where: { id: i.id } });
    expect(waiting).toMatchObject({ status: "DONE", awaitingCheck: true, completedAt: null, completedById: ids.ivy });
    expect(await ledger(i.id)).toBe(0);
    expect((await prisma.$transaction((tx) => checkChore(tx, kid(ids.max), i.id, true))).ok).toBe(false);
    expect((await prisma.$transaction((tx) => checkChore(tx, grownUp(), i.id, true))).ok).toBe(true);
    expect((await prisma.$transaction((tx) => checkChore(tx, grownUp(), i.id, true))).ok).toBe(false);
    expect(await ledger(i.id)).toBe(1);
    const paid = await prisma.pointsLedger.findFirstOrThrow({ where: { instanceId: i.id } });
    expect(paid).toMatchObject({ personId: ids.ivy, delta: 5 });
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: i.id } })).completedAt).not.toBeNull();
  });

  test("Not yet and a kid's own undo put it back with nothing to take back", async () => {
    const { completeChore, checkChore, uncompleteChore } = await import("@/lib/tasks/chore-cores");
    const a = await instance(ids.checked, ids.ivy, 1);
    await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), a.id));
    expect((await prisma.$transaction((tx) => checkChore(tx, grownUp(), a.id, false))).ok).toBe(true);
    expect(await prisma.taskInstance.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "PENDING", awaitingCheck: false, completedById: null });
    await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), a.id));
    expect((await prisma.$transaction((tx) => uncompleteChore(tx, kid(ids.ivy), a.id))).ok).toBe(true);
    expect(await prisma.taskInstance.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "PENDING", awaitingCheck: false });
    expect(await ledger(a.id)).toBe(0);
  });

  test("a grown-up's tick pays at once; a chore without the check pays a kid at once", async () => {
    const { completeChore } = await import("@/lib/tasks/chore-cores");
    const a = await instance(ids.checked, ids.ivy, 2);
    expect((await prisma.$transaction((tx) => completeChore(tx, grownUp(), a.id))).waiting).toBeUndefined();
    expect(await ledger(a.id)).toBe(1);
    // A kid's chore from yesterday (overdue) is theirs to tick.
    const b = await instance(ids.plain, ids.ivy, -2);
    await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), b.id));
    expect(await ledger(b.id)).toBe(1);
  });

  test("a kid can tick a chore from the day before it's due, never further ahead; a grown-up any time", async () => {
    const { completeChore } = await import("@/lib/tasks/chore-cores");
    const tomorrow = await instance(ids.plain, ids.ivy, 1);
    const later = await instance(ids.plain, ids.ivy, 13);
    expect((await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), tomorrow.id))).ok).toBe(true);
    expect(await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), later.id))).toEqual({ ok: false, reason: "not yet" });
    expect(await ledger(later.id)).toBe(0);
    expect((await prisma.$transaction((tx) => completeChore(tx, grownUp(), later.id))).ok).toBe(true);
  });

  test("a waiting chore: bulk and a grown-up's skip refuse it; the check survives the flag going off; meds never wait", async () => {
    const { completeChore, checkChore, skipChore, uncompleteChore } = await import("@/lib/tasks/chore-cores");
    const { waitingForCheck } = await import("./checks");
    const a = await instance(ids.checked, ids.ivy, -3);
    await prisma.$transaction((tx) => completeChore(tx, kid(ids.ivy), a.id));
    expect((await prisma.$transaction((tx) => skipChore(tx, grownUp(), a.id))).ok).toBe(false);
    expect((await prisma.$transaction((tx) => completeChore(tx, grownUp(), a.id))).ok).toBe(false);
    await prisma.taskDefinition.update({ where: { id: ids.checked }, data: { needsCheck: false } });
    expect((await waitingForCheck(ids.h)).map((r) => r.id)).toContain(a.id);
    expect((await prisma.$transaction((tx) => checkChore(tx, grownUp(), a.id, true))).ok).toBe(true);
    await prisma.taskDefinition.update({ where: { id: ids.checked }, data: { needsCheck: true } });
    // A grown-up's undo after the OK takes the stickers back.
    expect((await prisma.$transaction((tx) => uncompleteChore(tx, grownUp(), a.id))).ok).toBe(true);
    expect(await ledger(a.id)).toBe(0);
    const med = await prisma.taskDefinition.create({ data: { householdId: ids.h, domain: "MED", title: "Vitamin", frequencyType: "DAILY", startDate: today } });
    await prisma.taskInstance.create({ data: { definitionId: med.id, dueDate: today, status: "DONE", awaitingCheck: true } });
    expect((await waitingForCheck(ids.h)).every((r) => r.definition.title !== "Vitamin")).toBe(true);
  });

  test("swapped-from shows only while the chore is still where the swap put it", async () => {
    const { askSwap, answerSwap, swappedFrom } = await import("./swaps");
    const { reassignChore } = await import("@/lib/tasks/chore-cores");
    const a = await instance(ids.plain, ids.ivy, 12);
    await askSwap(swapper(ids.ivy), { instanceId: a.id, toId: ids.max, giveBackId: null }, today);
    const s = await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: a.id } });
    await answerSwap(swapper(ids.max), s.id, true, today);
    expect((await swappedFrom(ids.h, [a.id])).get(a.id)).toBe("Ivy");
    await prisma.$transaction((tx) => reassignChore(tx, grownUp(), a.id, { id: ids.ivy, firstName: "Ivy" }));
    expect((await swappedFrom(ids.h, [a.id])).has(a.id)).toBe(false);
  });

  test("a swap: asked, accepted, both chores move; a second accept changes nothing", async () => {
    const { askSwap, answerSwap } = await import("./swaps");
    const mine = await instance(ids.plain, ids.ivy, 3);
    const theirs = await instance(ids.plain, ids.max, 4);
    expect(await askSwap(swapper(ids.ivy), { instanceId: mine.id, toId: ids.max, giveBackId: theirs.id }, today)).toEqual({ ok: true });
    expect((await askSwap(swapper(ids.ivy), { instanceId: mine.id, toId: ids.max, giveBackId: null }, today)).ok).toBe(false);
    const swap = await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: mine.id } });
    // Two taps at once: one moves the chores.
    const results = await Promise.all([answerSwap(swapper(ids.max), swap.id, true, today), answerSwap(swapper(ids.max), swap.id, true, today)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: mine.id } })).assignedToId).toBe(ids.max);
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: theirs.id } })).assignedToId).toBe(ids.ivy);
  });

  test("refused: a grown-up asking, asking a grown-up, offering someone else's chore", async () => {
    const { askSwap } = await import("./swaps");
    const mine = await instance(ids.plain, ids.ivy, 5);
    const maxs = await instance(ids.plain, ids.max, 10);
    expect((await askSwap(swapper(ids.mom, "ADULT"), { instanceId: mine.id, toId: ids.max, giveBackId: null }, today)).ok).toBe(false);
    expect((await askSwap(swapper(ids.ivy), { instanceId: mine.id, toId: ids.mom, giveBackId: null }, today)).ok).toBe(false);
    expect((await askSwap(swapper(ids.ivy), { instanceId: maxs.id, toId: ids.max, giveBackId: null }, today)).ok).toBe(false);
  });

  test("a grown-up giving the chore to someone lapses the request; declining and cancelling close it", async () => {
    const { askSwap, answerSwap, cancelSwap, openSwaps } = await import("./swaps");
    const { reassignChore } = await import("@/lib/tasks/chore-cores");
    const a = await instance(ids.plain, ids.ivy, 6);
    await askSwap(swapper(ids.ivy), { instanceId: a.id, toId: ids.max, giveBackId: null }, today);
    await prisma.$transaction((tx) => reassignChore(tx, grownUp(), a.id, { id: ids.mom, firstName: "Mom" }));
    expect((await openSwaps(swapper(ids.max), today)).incoming).toHaveLength(0);
    expect((await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: a.id } })).status).toBe("LAPSED");

    const b = await instance(ids.plain, ids.ivy, 7);
    await askSwap(swapper(ids.ivy), { instanceId: b.id, toId: ids.max, giveBackId: null }, today);
    const s1 = await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: b.id, status: "PENDING" } });
    expect(await answerSwap(swapper(ids.max), s1.id, false, today)).toEqual({ ok: true });
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: b.id } })).assignedToId).toBe(ids.ivy);
    await askSwap(swapper(ids.ivy), { instanceId: b.id, toId: ids.max, giveBackId: null }, today);
    const s2 = await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: b.id, status: "PENDING" } });
    expect((await cancelSwap(swapper(ids.max), s2.id)).ok).toBe(false);
    expect(await cancelSwap(swapper(ids.ivy), s2.id)).toEqual({ ok: true });
  });

  test("accepting after the chore moved says it lapsed and moves nothing", async () => {
    const { askSwap, answerSwap } = await import("./swaps");
    const a = await instance(ids.plain, ids.ivy, 8);
    await askSwap(swapper(ids.ivy), { instanceId: a.id, toId: ids.max, giveBackId: null }, today);
    await prisma.taskInstance.update({ where: { id: a.id }, data: { dueDate: addDays(today, 9), movedFrom: addDays(today, 8) } });
    const s = await prisma.choreSwap.findFirstOrThrow({ where: { instanceId: a.id } });
    expect((await answerSwap(swapper(ids.max), s.id, true, today)).ok).toBe(false);
    expect((await prisma.taskInstance.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBe(ids.ivy);
    expect((await prisma.choreSwap.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("LAPSED");
  });
});
