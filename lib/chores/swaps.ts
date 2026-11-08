import { prisma } from "@/lib/prisma";
import { shortNames } from "@/lib/people";
import { recordEvent } from "@/lib/work-items/events";

/**
 * Phase 70c: kids swapping chores (the owner's call: the other kid accepts, no grown-up needed).
 * A kid asks another kid to take one of their pending chores, optionally taking one of that kid's
 * in return. Accepting moves both in one transaction, only if each is still pending, still whose
 * it was and on the day the request saw; otherwise the request has lapsed. Grown-ups can still
 * give any chore to anyone, as before, which lapses an open request on it.
 */

export type SwapViewer = { id: string; householdId: string; role: "ADULT" | "KID" | "ADMIN" | null };
export type SwapResult = { ok: true } | { ok: false; error: string };

const kidsOnly = "Swaps are for kids: grown-ups can give a chore to someone from its menu.";
export const SWAP_LAPSED = "That swap can't happen now: a chore was done, moved or given to someone else.";
const LAPSED = SWAP_LAPSED;

type InstanceState = { status: string; assignedToId: string | null; dueDate: Date } | null;

/** Whether a chore is still as the request saw it: pending, whose it was, on that day, not past. Pure. */
export function stillAsAsked(i: InstanceState, owner: string, day: Date, today: Date): boolean {
  return Boolean(i && i.status === "PENDING" && i.assignedToId === owner && i.dueDate.getTime() === day.getTime() && i.dueDate >= today);
}

/** A swap request still worth answering. Pure. */
export function swapStillGood(
  s: { fromId: string; toId: string; dueDate: Date; giveBackId: string | null; giveBackDueDate: Date | null },
  instance: InstanceState,
  giveBack: InstanceState,
  today: Date,
): boolean {
  if (!stillAsAsked(instance, s.fromId, s.dueDate, today)) return false;
  if (!s.giveBackId) return true;
  return s.giveBackDueDate !== null && stillAsAsked(giveBack, s.toId, s.giveBackDueDate, today);
}

const choreInstance = (householdId: string) => ({ definition: { householdId, domain: "CHORE" as const } });

/** Another kid in the household, still here. */
async function otherKid(viewer: SwapViewer, id: string) {
  if (id === viewer.id) return null;
  return prisma.person.findFirst({ where: { id, householdId: viewer.householdId, role: "KID", isHouseholdMember: true }, select: { id: true, firstName: true } });
}

/** A kid asks. One open request per chore. */
export async function askSwap(viewer: SwapViewer, input: { instanceId: string; toId: string; giveBackId: string | null }, today: Date): Promise<SwapResult> {
  if (viewer.role !== "KID") return { ok: false, error: kidsOnly };
  const to = await otherKid(viewer, input.toId);
  if (!to) return { ok: false, error: "Pick your brother or sister." };
  const [instance, giveBack] = await Promise.all([
    prisma.taskInstance.findFirst({ where: { id: input.instanceId, ...choreInstance(viewer.householdId) }, select: { id: true, status: true, assignedToId: true, dueDate: true } }),
    input.giveBackId
      ? prisma.taskInstance.findFirst({ where: { id: input.giveBackId, ...choreInstance(viewer.householdId) }, select: { id: true, status: true, assignedToId: true, dueDate: true } })
      : null,
  ]);
  if (!instance || !stillAsAsked(instance, viewer.id, instance.dueDate, today)) return { ok: false, error: "Pick one of your chores that's still to do." };
  if (input.giveBackId && (!giveBack || !stillAsAsked(giveBack, to.id, giveBack.dueDate, today))) {
    return { ok: false, error: `Pick one of ${to.firstName}'s chores that's still to do, or none.` };
  }
  const open = await prisma.choreSwap.count({ where: { instanceId: instance.id, status: "PENDING" } });
  if (open > 0) return { ok: false, error: "You've already asked about that chore." };
  await prisma.choreSwap.create({
    data: {
      householdId: viewer.householdId,
      instanceId: instance.id,
      dueDate: instance.dueDate,
      fromId: viewer.id,
      toId: to.id,
      giveBackId: giveBack?.id ?? null,
      giveBackDueDate: giveBack?.dueDate ?? null,
    },
  });
  return { ok: true };
}

/** The asked kid accepts or declines. Accepting moves both chores, or says it lapsed. */
export async function answerSwap(viewer: SwapViewer, swapId: string, accept: boolean, today: Date): Promise<SwapResult> {
  if (viewer.role !== "KID") return { ok: false, error: kidsOnly };
  const swap = await prisma.choreSwap.findFirst({ where: { id: swapId, householdId: viewer.householdId, toId: viewer.id, status: "PENDING" } });
  if (!swap) return { ok: false, error: "That swap isn't waiting for you anymore." };
  if (!accept) {
    await prisma.choreSwap.updateMany({ where: { id: swap.id, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
    return { ok: true };
  }
  // A day already past can't be swapped any more.
  if (swap.dueDate < today || (swap.giveBackDueDate && swap.giveBackDueDate < today)) {
    await prisma.choreSwap.updateMany({ where: { id: swap.id, status: "PENDING" }, data: { status: "LAPSED", decidedAt: new Date() } });
    return { ok: false, error: LAPSED };
  }
  const names = await prisma.person.findMany({ where: { id: { in: [swap.fromId, swap.toId] } }, select: { id: true, firstName: true } });
  const first = (id: string) => names.find((n) => n.id === id)?.firstName ?? null;
  const moved = await prisma.$transaction(async (tx) => {
    // Claims the request first, so two taps (or two phones) can't both run it.
    const claimed = await tx.choreSwap.updateMany({ where: { id: swap.id, status: "PENDING" }, data: { status: "ACCEPTED", decidedAt: new Date() } });
    if (claimed.count === 0) return false;
    const one = await tx.taskInstance.updateMany({
      where: { id: swap.instanceId, status: "PENDING", assignedToId: swap.fromId, dueDate: swap.dueDate },
      data: { assignedToId: swap.toId },
    });
    const two = swap.giveBackId
      ? await tx.taskInstance.updateMany({
          where: { id: swap.giveBackId, status: "PENDING", assignedToId: swap.toId, dueDate: swap.giveBackDueDate ?? undefined },
          data: { assignedToId: swap.fromId },
        })
      : { count: 1 };
    // Either chore changed since: nothing moves (the transaction rolls back).
    if (one.count !== 1 || two.count !== 1) throw new SwapLapsed();
    await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: swap.instanceId, actorId: viewer.id, action: "ASSIGN", fromValue: first(swap.fromId), toValue: first(swap.toId) });
    if (swap.giveBackId) {
      await recordEvent(tx, { householdId: viewer.householdId, itemType: "CHORE", itemId: swap.giveBackId, actorId: viewer.id, action: "ASSIGN", fromValue: first(swap.toId), toValue: first(swap.fromId) });
    }
    return true;
  }).catch(async (err: unknown) => {
    if (!(err instanceof SwapLapsed)) throw err;
    await prisma.choreSwap.updateMany({ where: { id: swap.id, status: "PENDING" }, data: { status: "LAPSED", decidedAt: new Date() } });
    return null;
  });
  if (moved === null) return { ok: false, error: LAPSED };
  if (!moved) return { ok: false, error: "That swap isn't waiting for you anymore." };
  return { ok: true };
}

class SwapLapsed extends Error {}

/** The kid who asked takes it back. */
export async function cancelSwap(viewer: SwapViewer, swapId: string): Promise<SwapResult> {
  const { count } = await prisma.choreSwap.updateMany({ where: { id: swapId, householdId: viewer.householdId, fromId: viewer.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
  return count ? { ok: true } : { ok: false, error: "That swap isn't open anymore." };
}

export type SwapView = { id: string; from: string; to: string; chore: string; day: Date; giveBack: { chore: string; day: Date } | null };

/**
 * A kid's open requests, both ways. One that's no longer as asked (done, moved, given to someone,
 * past) is marked lapsed here and left out.
 */
export async function openSwaps(viewer: SwapViewer, today: Date): Promise<{ incoming: SwapView[]; outgoing: SwapView[] }> {
  if (viewer.role !== "KID") return { incoming: [], outgoing: [] };
  const rows = await prisma.choreSwap.findMany({
    where: { householdId: viewer.householdId, status: "PENDING", OR: [{ toId: viewer.id }, { fromId: viewer.id }] },
    include: {
      instance: { select: { status: true, assignedToId: true, dueDate: true, definition: { select: { title: true } } } },
      giveBack: { select: { status: true, assignedToId: true, dueDate: true, definition: { select: { title: true } } } },
      from: { select: { id: true, firstName: true, lastName: true } },
      to: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const stale = rows.filter((r) => !swapStillGood(r, r.instance, r.giveBack, today)).map((r) => r.id);
  if (stale.length) await prisma.choreSwap.updateMany({ where: { id: { in: stale }, status: "PENDING" }, data: { status: "LAPSED", decidedAt: new Date() } });
  const names = shortNames(rows.flatMap((r) => [r.from, r.to]));
  const view = (r: (typeof rows)[number]): SwapView => ({
    id: r.id,
    from: names.get(r.fromId) ?? r.from.firstName,
    to: names.get(r.toId) ?? r.to.firstName,
    chore: r.instance.definition.title,
    day: r.dueDate,
    giveBack: r.giveBack && r.giveBackDueDate ? { chore: r.giveBack.definition.title, day: r.giveBackDueDate } : null,
  });
  const good = rows.filter((r) => !stale.includes(r.id));
  return { incoming: good.filter((r) => r.toId === viewer.id).map(view), outgoing: good.filter((r) => r.fromId === viewer.id).map(view) };
}

/** For grown-ups: the kids' open requests, read only (they can still give any chore to anyone). */
export async function openSwapsForGrownUps(householdId: string, today: Date): Promise<SwapView[]> {
  const rows = await prisma.choreSwap.findMany({
    where: { householdId, status: "PENDING" },
    include: {
      instance: { select: { status: true, assignedToId: true, dueDate: true, definition: { select: { title: true } } } },
      giveBack: { select: { status: true, assignedToId: true, dueDate: true, definition: { select: { title: true } } } },
      from: { select: { id: true, firstName: true, lastName: true } },
      to: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const names = shortNames(rows.flatMap((r) => [r.from, r.to]));
  return rows
    .filter((r) => swapStillGood(r, r.instance, r.giveBack, today))
    .map((r) => ({
      id: r.id,
      from: names.get(r.fromId) ?? r.from.firstName,
      to: names.get(r.toId) ?? r.to.firstName,
      chore: r.instance.definition.title,
      day: r.dueDate,
      giveBack: r.giveBack && r.giveBackDueDate ? { chore: r.giveBack.definition.title, day: r.giveBackDueDate } : null,
    }));
}

/** For grown-ups: which of these chores a kid took over by a swap, and from whom. */
export async function swappedFrom(householdId: string, instanceIds: string[]): Promise<Map<string, string>> {
  if (instanceIds.length === 0) return new Map();
  const rows = await prisma.choreSwap.findMany({
    where: { householdId, status: "ACCEPTED", OR: [{ instanceId: { in: instanceIds } }, { giveBackId: { in: instanceIds } }] },
    select: {
      instanceId: true,
      giveBackId: true,
      fromId: true,
      toId: true,
      instance: { select: { assignedToId: true } },
      giveBack: { select: { assignedToId: true } },
      from: { select: { firstName: true } },
      to: { select: { firstName: true } },
    },
    orderBy: { decidedAt: "asc" },
  });
  const out = new Map<string, string>();
  for (const r of rows) {
    // Only while it's still where the swap put it: a grown-up giving it back ends the note.
    if (r.instance.assignedToId === r.toId) out.set(r.instanceId, r.from.firstName);
    else out.delete(r.instanceId);
    if (r.giveBackId && r.giveBack) {
      if (r.giveBack.assignedToId === r.fromId) out.set(r.giveBackId, r.to.firstName);
      else out.delete(r.giveBackId);
    }
  }
  return out;
}

/** What a kid can offer and ask for: their own chores still to do, and each other kid's. */
export async function swapChoices(viewer: SwapViewer, today: Date) {
  if (viewer.role !== "KID") return null;
  const [kids, chores] = await Promise.all([
    prisma.person.findMany({ where: { householdId: viewer.householdId, role: "KID", isHouseholdMember: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } }),
    prisma.taskInstance.findMany({
      where: { ...choreInstance(viewer.householdId), status: "PENDING", dueDate: { gte: today }, assignedTo: { role: "KID", isHouseholdMember: true } },
      select: { id: true, dueDate: true, assignedToId: true, definition: { select: { title: true } } },
      orderBy: [{ dueDate: "asc" }],
      take: 200,
    }),
  ]);
  const names = shortNames(kids);
  const choresOf = (id: string) => chores.filter((c) => c.assignedToId === id).map((c) => ({ id: c.id, title: c.definition.title, day: c.dueDate }));
  return {
    mine: choresOf(viewer.id),
    others: kids.filter((k) => k.id !== viewer.id).map((k) => ({ id: k.id, name: names.get(k.id) ?? k.firstName, chores: choresOf(k.id) })),
  };
}
