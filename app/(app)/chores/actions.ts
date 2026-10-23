"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult, isAdult } from "@/lib/authz";
import { milestoneCrossed } from "@/lib/tasks/milestones";
import { atMidnight } from "@/lib/tasks/schedule";
import { markOlderMissed as markOlderTasksMissed, skipInstance as skipTask, unskipInstance as unskipTask } from "@/lib/tasks/skip";

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
  const result = parseTaskForm(formData);
  if ("error" in result) return { error: result.error };

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
  const result = parseTaskForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: profile.householdId, domain: "CHORE" },
  });
  if (!existing) return { error: "Chore not found." };

  await prisma.taskDefinition.update({
    where: { id: definitionId },
    data: {
      ...result.fields,
      assignees: { set: result.assigneeIds.map((id) => ({ id })) },
    },
  });

  revalidatePath("/chores");
  redirect("/chores/manage");
}

export async function setDefinitionActive(definitionId: string, active: boolean) {
  const profile = await requireAdult();

  const updated = await prisma.taskDefinition.updateMany({
    where: { id: definitionId, householdId: profile.householdId, domain: "CHORE" },
    data: { active },
  });

  // Same as Meds' setDefinitionActive: already-generated future days (up to 14 out) would
  // otherwise keep showing on the board, Home and the calendar after the chore is paused.
  // Reactivating rolls forward from today like a new chore.
  if (updated.count > 0 && !active) {
    await prisma.taskInstance.deleteMany({
      where: { definitionId, status: "PENDING", dueDate: { gte: atMidnight(new Date()) } },
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
export async function completeInstance(instanceId: string): Promise<{ milestone?: number | null }> {
  const profile = await requireActiveProfile();

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: true },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "CHORE") {
    throw new Error("Chore not found");
  }
  // A kid may do their own chore, or claim an "Anyone" one (owner's call, 2026-10-09): the stickers go
  // to whoever does it (pointsRecipient below), so grabbing one is earning it.
  if (!isAdult(profile) && instance.assignedToId !== profile.id && instance.assignedToId !== null) return {};

  const pointsRecipient = instance.assignedToId ?? profile.id;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "PENDING", assignedToId: instance.assignedToId },
      data: { status: "DONE", completedAt: now, completedById: profile.id },
    });
    if (count === 0) return { completed: false, milestone: null };

    const priorCompletions = await tx.pointsLedger.count({
      where: { personId: pointsRecipient, instanceId: { not: null }, instance: { definition: { domain: "CHORE" } } },
    });

    await tx.pointsLedger.create({
      data: {
        personId: pointsRecipient,
        delta: instance.definition.points,
        reason: instance.definition.title,
        instanceId: instance.id,
      },
    });

    return { completed: true, milestone: milestoneCrossed(priorCompletions, priorCompletions + 1) };
  });

  revalidatePath("/chores");
  revalidatePath("/points");
  revalidatePath("/");

  return result.completed ? { milestone: result.milestone } : {};
}

export async function uncompleteInstance(instanceId: string) {
  const profile = await requireActiveProfile();

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: true },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "CHORE") {
    throw new Error("Chore not found");
  }
  if (!isAdult(profile) && instance.completedById !== profile.id) return;

  await prisma.$transaction(async (tx) => {
    // Pins completedAt, not just status: "DONE" — undoing THE COMPLETION I SAW, not
    // "whatever's currently DONE" (same guard Meds' uncompleteInstance uses).
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "DONE", completedAt: instance.completedAt },
      data: { status: "PENDING", completedAt: null, completedById: null },
    });
    if (count === 0) return;

    await tx.pointsLedger.deleteMany({ where: { instanceId: instance.id } });
  });

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

  const instance = await prisma.taskInstance.findFirst({
    where: { id: instanceId, definition: { householdId: profile.householdId, domain: "CHORE" } },
  });
  if (!instance) return;

  const target = await prisma.person.findFirst({
    where: { id: newAssigneeId, householdId: profile.householdId, isHouseholdMember: true },
    select: { id: true },
  });
  if (!target) return;

  await prisma.taskInstance.updateMany({
    where: { id: instanceId, status: "PENDING" },
    data: { assignedToId: target.id },
  });

  revalidatePath("/chores");
  revalidatePath("/");
}

/**
 * A grown-up's "Skip" / "Missed" (lib/tasks/skip.ts): nobody did it, so nobody gets stickers.
 * Kids can't: skipping is how a chore would quietly disappear.
 */
export async function skipInstance(instanceId: string) {
  const profile = await requireAdult();
  if (await skipTask({ householdId: profile.householdId, domain: "CHORE", instanceId, byId: profile.id })) revalidateBoard();
}

export async function unskipInstance(instanceId: string) {
  const profile = await requireAdult();
  if (await unskipTask({ householdId: profile.householdId, domain: "CHORE", instanceId })) revalidateBoard();
}

/**
 * Everything still waiting from before the overdue window (lib/tasks/skip.ts), in one go, for
 * the person the board is filtered to (or everyone). A person outside the household matches
 * nothing, since the definition is household-scoped.
 */
export async function markOlderMissed(personId: string | null) {
  const profile = await requireAdult();
  // A malformed id does nothing, rather than falling back to everyone.
  if (personId !== null && (typeof personId !== "string" || personId.length === 0 || personId.length > 64)) return;
  const who = personId;
  if (await markOlderTasksMissed({ householdId: profile.householdId, domain: "CHORE", byId: profile.id, personId: who })) revalidateBoard();
}

function revalidateBoard() {
  revalidatePath("/chores");
  revalidatePath("/");
}
