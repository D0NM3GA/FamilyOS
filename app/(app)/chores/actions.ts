"use server";

import { assertAppOn } from "@/lib/app-guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { allHouseholdMembers } from "@/lib/people";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult, isAdult } from "@/lib/authz";
import { atMidnight } from "@/lib/tasks/schedule";
import { markOlderMissedIds } from "@/lib/tasks/skip";
import { scheduleChanged } from "@/lib/tasks/edit";
import { checkChore, completeChore, reassignChore, skipChore, uncompleteChore, unskipChore } from "@/lib/tasks/chore-cores";
import { answerSwap, askSwap, cancelSwap, SWAP_LAPSED } from "@/lib/chores/swaps";
import { deleteEventsFor, recordEvents } from "@/lib/work-items/events";
import { moveChore, moveChoreIn, type MoveTarget } from "@/lib/tasks/move";
import { withStoredDays } from "@/lib/household-zone";
import { BULK_TIMEOUT_MS, summarize, type BulkResult } from "@/lib/work-items/bulk";
import { bulkSchema } from "@/lib/work-items/bulk-schema";

export type TaskFormState = { error?: string };

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  notes: z.string().trim().optional(),
  frequencyType: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "INTERVAL_DAYS", "DAYS_OF_WEEK"]),
  interval: z.coerce.number().int().min(1).optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date")
    .transform((v) => {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
  points: z.coerce.number().int().min(0),
  assignmentStrategy: z.enum(["FIXED", "ROUND_ROBIN", "LEAST_ASSIGNED"]),
  assigneeIds: z.array(z.string()).min(1, "Pick at least one person"),
  weatherSensitive: z.boolean(),
  needsCheck: z.boolean(),
});

function parseTaskForm(formData: FormData) {
  const intervalRaw = String(formData.get("interval") ?? "").trim();

  const raw = {
    title: String(formData.get("title") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    frequencyType: String(formData.get("frequencyType") ?? ""),
    interval: intervalRaw || undefined,
    daysOfWeek: formData.getAll("daysOfWeek").map(String),
    startDate: String(formData.get("startDate") ?? ""),
    points: String(formData.get("points") ?? "0"),
    assignmentStrategy: String(formData.get("assignmentStrategy") ?? ""),
    assigneeIds: formData.getAll("assigneeIds").map(String),
    weatherSensitive: formData.get("weatherSensitive") === "on",
    needsCheck: formData.get("needsCheck") === "on",
  };

  const parsed = taskFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }

  const { assigneeIds, notes, interval, ...rest } = parsed.data;
  return {
    fields: { ...rest, notes: notes || null, interval: interval ?? null },
    assigneeIds,
  } as const;
}

export async function createTaskDefinition(
  _prevState: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const result = parseTaskForm(formData);
  if ("error" in result) return { error: result.error };
  if (!(await allHouseholdMembers(result.assigneeIds, profile.householdId))) return { error: "Pick people from the household." };

  await prisma.taskDefinition.create({
    data: {
      householdId: profile.householdId,
      domain: "CHORE",
      ...result.fields,
      assignees: { connect: result.assigneeIds.map((id) => ({ id })) },
    },
  });

  revalidatePath("/chores");
  redirect("/chores");
}

export async function updateTaskDefinition(
  definitionId: string,
  _prevState: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const result = parseTaskForm(formData);
  if ("error" in result) return { error: result.error };
  if (!(await allHouseholdMembers(result.assigneeIds, profile.householdId))) return { error: "Pick people from the household." };

  const existing = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: profile.householdId, domain: "CHORE" },
    include: { assignees: { select: { id: true } } },
  });
  if (!existing) return { error: "Chore not found." };
  // Phase 66a: a new schedule or pool applies now, not in two weeks. The days already planned
  // from the old one go (not ones moved by hand, which keep their new day), and the board,
  // Home and the calendar plan the new ones on their next load, the same as Meds' edit.
  const replan = scheduleChanged({ ...existing, assigneeIds: existing.assignees.map((a) => a.id) }, { ...result.fields, assigneeIds: result.assigneeIds });

  await prisma.$transaction(async (tx) => {
    await tx.taskDefinition.update({
      where: { id: definitionId },
      data: {
        ...result.fields,
        assignees: { set: result.assigneeIds.map((id) => ({ id })) },
      },
    });
    if (replan) {
      const waiting = { definitionId, status: "PENDING" as const, dueDate: { gte: atMidnight(new Date()) }, movedFrom: null };
      const going = await tx.taskInstance.findMany({ where: waiting, select: { id: true } });
      await tx.taskInstance.deleteMany({ where: { id: { in: going.map((i) => i.id) } } });
      await deleteEventsFor(tx, "CHORE", going.map((i) => i.id));
    }
  });

  revalidatePath("/chores");
  revalidatePath("/calendar");
  revalidatePath("/");
  redirect("/chores/manage");
}

export async function setDefinitionActive(definitionId: string, active: boolean) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");

  const updated = await prisma.taskDefinition.updateMany({
    where: { id: definitionId, householdId: profile.householdId, domain: "CHORE" },
    data: { active },
  });

  // Same as Meds' setDefinitionActive: already-generated future days (up to 14 out) would
  // otherwise keep showing on the board, Home and the calendar after the chore is paused.
  // Reactivating rolls forward from today like a new chore.
  if (updated.count > 0 && !active) {
    // Their history goes with them (Phase 59.1c: WorkItemEvent has no foreign key to clean up for it).
    // The delete keeps its criteria, so a day rolled forward in between goes too; one made
    // in between has no history yet, so the ids found first are all the cleanup needs.
    const waiting = { definitionId, status: "PENDING" as const, dueDate: { gte: atMidnight(new Date()) } };
    await prisma.$transaction(async (tx) => {
      const going = await tx.taskInstance.findMany({ where: waiting, select: { id: true } });
      await tx.taskInstance.deleteMany({ where: waiting });
      await deleteEventsFor(tx, "CHORE", going.map((i) => i.id));
    });
  }

  revalidatePath("/chores");
  revalidatePath("/chores/manage");
  revalidatePath("/calendar");
  revalidatePath("/");
}

/**
 * Points go to whoever the chore was FOR, not whoever marked it done — brought in line
 * with Meds' Phase 9 rule (`instance.assignedToId ?? profile.id`) rather than the previous
 * `profile.id`-always behavior, so an adult completing a kid's chore credits the kid. This
 * is a real, visible behavior change (an adult's own points pill stops moving for chores
 * they complete on someone else's behalf) — deliberate, confirmed for this phase, not a
 * silent side effect of the transaction rewrite below.
 *
 * Uses an atomic `status: "PENDING"` guard inside an interactive transaction — the same
 * fix Meds' completeInstance got in Phase 9 — so two near-simultaneous completions of the
 * same instance can't both succeed (the second `updateMany` matches zero rows and the
 * whole transaction becomes a no-op instead of double-awarding points). Also now checks
 * `domain === "CHORE"` explicitly (previously missing — Chores' completeInstance could
 * complete a MED instance under Chores' own points rule).
 *
 * Returns the milestone crossed (if any) — see lib/tasks/milestones.ts — computed from a
 * count of this person's CHORE-credited PointsLedger rows, the same definition of
 * "credited" the points recipient rule above just established, so the two can't disagree.
 *
 * A kid's board can go stale the moment `reassignInstance` moves a card off them from
 * another device — this reads the current `assignedToId` fresh rather than trusting
 * whatever the kid's card last rendered, so a no-longer-mine tap silently no-ops (matching
 * the "convenience action must never throw" rule) instead of throwing into the full-panel
 * error boundary. And because the completion guard below pins `assignedToId` to the same
 * snapshot read here, a reassignment that lands mid-transaction also no-ops rather than
 * crediting whoever the instance belonged to a moment ago.
 */
export async function completeInstance(instanceId: string): Promise<{ milestone?: number | null; waiting?: boolean }> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "chores");
  const viewer = { id: profile.id, householdId: profile.householdId, adult: isAdult(profile) };
  const result = await prisma.$transaction((tx) => completeChore(tx, viewer, instanceId));
  if (!result.ok && result.reason === "not found") throw new Error("Chore not found");

  revalidatePath("/chores");
  revalidatePath("/points");
  revalidatePath("/");

  return result.ok ? { milestone: result.milestone, waiting: result.waiting } : {};
}

export async function uncompleteInstance(instanceId: string) {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "chores");
  const viewer = { id: profile.id, householdId: profile.householdId, adult: isAdult(profile) };
  const result = await prisma.$transaction((tx) => uncompleteChore(tx, viewer, instanceId));
  if (!result.ok && result.reason === "not found") throw new Error("Chore not found");

  revalidatePath("/chores");
  revalidatePath("/points");
  revalidatePath("/");
}

/**
 * The cheap version of a swap-request state machine: an adult moves a still-PENDING
 * instance to someone else, one-off — not restricted to the definition's own assignee
 * pool (a one-time "you do it today" is the whole point). Only ever touches a PENDING
 * instance — a DONE one already credited someone via completeInstance, and reassigning it
 * afterward would desync who has the points from who the card says did it.
 *
 * Note for anyone touching lib/tasks/instances.ts's rotation logic later: planInstances
 * reads assignedToId from recent instances as history, so a reassignment counts toward the
 * new person under LEAST_ASSIGNED (arguably correct — they did end up doing it) and only
 * affects ROUND_ROBIN if it happens to be the most recent instance by due date, which in
 * practice it never is (the board pre-generates a 14-day horizon, so "most recent" is
 * always a future instance no reassignment has touched yet).
 */
export async function reassignInstance(instanceId: string, newAssigneeId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");

  const target = await prisma.person.findFirst({
    where: { id: newAssigneeId, householdId: profile.householdId, isHouseholdMember: true },
    select: { id: true, firstName: true },
  });
  if (!target) return;
  await prisma.$transaction((tx) => reassignChore(tx, { id: profile.id, householdId: profile.householdId, adult: true }, instanceId, target));

  revalidatePath("/chores");
  revalidatePath("/");
}

/**
 * A grown-up's "Skip" / "Missed" (lib/tasks/skip.ts): nobody did it, so nobody gets stickers.
 * Kids can't: skipping is how a chore would quietly disappear.
 */
export async function skipInstance(instanceId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const skipped = (await prisma.$transaction((tx) => skipChore(tx, { id: profile.id, householdId: profile.householdId, adult: true }, instanceId))).ok;
  if (skipped) revalidateBoard();
}

export async function unskipInstance(instanceId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const back = (await prisma.$transaction((tx) => unskipChore(tx, { id: profile.id, householdId: profile.householdId, adult: true }, instanceId))).ok;
  if (back) revalidateBoard();
}

/**
 * Everything still waiting from before the overdue window (lib/tasks/skip.ts), in one go, for
 * the person the board is filtered to (or everyone). A person outside the household matches
 * nothing, since the definition is household-scoped.
 */
export async function markOlderMissed(personId: string | null) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  // A malformed id does nothing, rather than falling back to everyone.
  if (personId !== null && (typeof personId !== "string" || personId.length === 0 || personId.length > 64)) return;
  const who = personId;
  const marked = await prisma.$transaction(async (tx) => {
    const ids = await markOlderMissedIds({ householdId: profile.householdId, domain: "CHORE", byId: profile.id, personId: who, db: tx });
    await recordEvents(
      tx,
      ids.map((itemId) => ({ householdId: profile.householdId, itemType: "CHORE" as const, itemId, actorId: profile.id, action: "STATUS" as const, fromValue: "PENDING", toValue: "SKIPPED" })),
    );
    return ids.length;
  });
  if (marked) revalidateBoard();
}

/**
 * Phase 59.2b: a grown-up's Move to tomorrow / Move to today / Move back (lib/tasks/move.ts). Says
 * whether it moved: a day taken in the meantime, or a chore changed underneath, is refused, and the
 * board refreshes either way so a stale option goes.
 */
export async function moveInstance(instanceId: string, to: MoveTarget | "back"): Promise<{ moved: boolean }> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  if (to !== "today" && to !== "tomorrow" && to !== "back") return { moved: false };
  const moved = await moveChore({ householdId: profile.householdId, instanceId, to, byId: profile.id });
  revalidateBoard();
  if (moved) revalidatePath("/calendar");
  return { moved };
}

function revalidateBoard() {
  revalidatePath("/chores");
  revalidatePath("/");
}

const choreBulk = bulkSchema(["DONE", "SKIP", "REASSIGN", "TOMORROW"] as const);

/**
 * Phase 59.3: one action on up to 30 chores, grown-ups only, in one transaction under the
 * stored-days lock (Move to tomorrow needs it). Each goes through the same core as a single tap;
 * one a rule refuses is skipped and counted, never thrown.
 */
export async function bulkChores(input: unknown): Promise<BulkResult | { error: string }> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const parsed = choreBulk.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That didn't look right." };
  const { ids, action, value } = parsed.data;
  const viewer = { id: profile.id, householdId: profile.householdId, adult: true };
  let target: { id: string; firstName: string } | null = null;
  if (action === "REASSIGN") {
    target = value ? await prisma.person.findFirst({ where: { id: value, householdId: profile.householdId, isHouseholdMember: true }, select: { id: true, firstName: true } }) : null;
    if (!target) return { error: "That family member wasn't found." };
  }
  const results = await withStoredDays(async (tx) => {
    const out: Parameters<typeof summarize>[0] = [];
    for (const id of ids) {
      if (action === "DONE") out.push(await completeChore(tx, viewer, id));
      else if (action === "SKIP") out.push(await skipChore(tx, viewer, id));
      else if (action === "REASSIGN") out.push(await reassignChore(tx, viewer, id, target!));
      else out.push((await moveChoreIn(tx, { householdId: profile.householdId, instanceId: id, to: "tomorrow", byId: profile.id })) ? { ok: true } : { ok: false, reason: "can't move" });
    }
    return out;
  }, { timeout: BULK_TIMEOUT_MS });
  revalidateBoard();
  if (action === "DONE") revalidatePath("/points");
  if (action === "TOMORROW") revalidatePath("/calendar");
  return summarize(results);
}

/**
 * Phase 70c: a grown-up's check on a chore a kid ticked: OK pays its stickers, Not yet puts it back
 * to do. A stale tap (already checked, or undone) changes nothing.
 */
export async function checkInstance(instanceId: string, ok: boolean): Promise<void> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "chores");
  const done = await prisma.$transaction((tx) => checkChore(tx, { id: profile.id, householdId: profile.householdId, adult: true }, instanceId, ok));
  revalidateBoard();
  revalidatePath("/points");
  // The row leaves the list, so the page says what happened (a stale tap says nothing).
  if (done.ok) redirect(`/chores?check=${ok ? "ok" : "again"}`);
}

export type SwapState = { error?: string };

/** Phase 70c: a kid asks another kid to take a chore, maybe taking one of theirs back. */
export async function askChoreSwap(_prev: SwapState, formData: FormData): Promise<SwapState> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "chores");
  const done = await askSwap(
    profile,
    {
      instanceId: String(formData.get("instanceId") ?? "").slice(0, 200),
      toId: String(formData.get("toId") ?? "").slice(0, 200),
      giveBackId: String(formData.get("giveBackId") ?? "").slice(0, 200) || null,
    },
    atMidnight(new Date()),
  );
  if (!done.ok) return { error: done.error };
  revalidatePath("/chores");
  redirect("/chores?swap=asked");
}

/** Phase 70c: the asked kid says yes or no. */
export async function answerChoreSwap(swapId: string, accept: boolean): Promise<void> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "chores");
  const done = await answerSwap(profile, swapId, accept, atMidnight(new Date()));
  revalidateBoard();
  if (!done.ok) redirect(`/chores?swap=${done.error === SWAP_LAPSED ? "lapsed" : "gone"}`);
  // The row leaves the list, so the page says what happened.
  redirect(`/chores?swap=${accept ? "taken" : "declined"}`);
}

/** Phase 70c: the kid who asked takes it back. */
export async function cancelChoreSwap(swapId: string): Promise<void> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "chores");
  await cancelSwap(profile, swapId);
  revalidatePath("/chores");
}
