"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult, assertOwnRecord } from "@/lib/authz";
import { atMidnight } from "@/lib/tasks/schedule";
import { doseConsumption, isLowStock } from "@/lib/meds/quantity";
import { searchRxTerms } from "@/lib/meds/rxterms";
import { medFormSchema } from "@/lib/meds/form";
import { requestItemByName } from "@/lib/shopping-list";
import { captureError } from "@/lib/observability";
import { markOlderMissed as markOlderTasksMissed, skipInstance as skipTask, unskipInstance as unskipTask } from "@/lib/tasks/skip";

export type TaskFormState = { error?: string };

function parseMedForm(formData: FormData) {
  const intervalRaw = String(formData.get("interval") ?? "").trim();
  // A blank <input type="time"> row submits "" — drop those before validating the rest.
  const timesRaw = formData.getAll("timesOfDay").map(String).filter((t) => t !== "");
  const numOrUndefined = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw || undefined;
  };
  const idOrUndefined = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw || undefined;
  };

  const raw = {
    title: String(formData.get("title") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    frequencyType: String(formData.get("frequencyType") ?? ""),
    interval: intervalRaw || undefined,
    daysOfWeek: formData.getAll("daysOfWeek").map(String),
    startDate: String(formData.get("startDate") ?? ""),
    points: String(formData.get("points") ?? "0"),
    timesOfDay: timesRaw,
    assigneeIds: formData.getAll("assigneeIds").map(String),
    quantityOnHand: numOrUndefined("quantityOnHand"),
    doseAmount: numOrUndefined("doseAmount"),
    refillThresholdQuantity: numOrUndefined("refillThresholdQuantity"),
    prescriberId: idOrUndefined("prescriberId"),
    pharmacyId: idOrUndefined("pharmacyId"),
  };

  const parsed = medFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  }

  const {
    assigneeIds,
    notes,
    interval,
    timesOfDay,
    quantityOnHand,
    doseAmount,
    refillThresholdQuantity,
    prescriberId,
    pharmacyId,
    ...rest
  } = parsed.data;
  const dedupedTimes = Array.from(new Set(timesOfDay)).sort();

  return {
    fields: { ...rest, notes: notes || null, interval: interval ?? null, timesOfDay: dedupedTimes },
    assigneeIds,
    medFields: {
      quantityOnHand: quantityOnHand ?? null,
      doseAmount: doseAmount ?? null,
      refillThresholdQuantity: refillThresholdQuantity ?? null,
      prescriberId: prescriberId ?? null,
      pharmacyId: pharmacyId ?? null,
    },
  } as const;
}

/**
 * Confirms a prescriber/pharmacy picker's value actually belongs to the viewer's household
 * AND is an external contact — a bound action taking an arbitrary Person id would
 * otherwise let one household link a person from a different household onto a Medication
 * row (same class of check app/(app)/people/[id]/actions.ts's addRelationship does for its
 * own person picker), and the picker only ever lists contacts, so a household member
 * reaching this some other way shouldn't silently succeed either.
 */
async function assertPersonInHousehold(personId: string | null, householdId: string) {
  if (!personId) return;
  const person = await prisma.person.findFirst({
    where: { id: personId, householdId, isHouseholdMember: false },
    select: { id: true },
  });
  if (!person) throw new Error("Selected person not found.");
}

export async function createTaskDefinition(
  _prevState: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const profile = await requireAdult();
  const result = parseMedForm(formData);
  if ("error" in result) return { error: result.error };

  await Promise.all([
    assertPersonInHousehold(result.medFields.prescriberId, profile.householdId),
    assertPersonInHousehold(result.medFields.pharmacyId, profile.householdId),
  ]);

  await prisma.taskDefinition.create({
    data: {
      householdId: profile.householdId,
      domain: "MED",
      assignmentStrategy: "FIXED",
      ...result.fields,
      assignees: { connect: result.assigneeIds.map((id) => ({ id })) },
      medication: { create: result.medFields },
    },
  });

  revalidatePath("/meds");
  revalidatePath("/");
  redirect("/meds");
}

export async function updateTaskDefinition(
  definitionId: string,
  _prevState: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const profile = await requireAdult();
  const result = parseMedForm(formData);
  if ("error" in result) return { error: result.error };

  const existing = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: profile.householdId, domain: "MED" },
  });
  if (!existing) return { error: "Medication not found." };

  await Promise.all([
    assertPersonInHousehold(result.medFields.prescriberId, profile.householdId),
    assertPersonInHousehold(result.medFields.pharmacyId, profile.householdId),
  ]);

  await prisma.$transaction([
    prisma.taskDefinition.update({
      where: { id: definitionId },
      data: {
        ...result.fields,
        assignmentStrategy: "FIXED",
        assignees: { set: result.assigneeIds.map((id) => ({ id })) },
        // Overwrites quantityOnHand from the form value — a lost update against any dose
        // completed between page load and save, same trade-off as updateVehicle's odometer
        // override. Framed as "correct the count," not a running total.
        medication: { upsert: { create: result.medFields, update: result.medFields } },
      },
    }),
    // Drop not-yet-taken future instances so roll-forward regenerates at the new
    // recurrence/times instead of leaving stale-time instances sitting until the old
    // schedule's latest instance is caught up to. DONE instances (already-taken doses)
    // are untouched — nothing is keyed to delete them, and their points-ledger rows
    // reference them by instance id, not dueDate, so nothing is orphaned. A doseAmount
    // change here is NOT retroactive either: past instances keep whatever
    // quantityConsumed they were completed with; only future completions use the new
    // amount.
    prisma.taskInstance.deleteMany({
      where: { definitionId, status: "PENDING", dueDate: { gte: atMidnight(new Date()) } },
    }),
  ]);

  revalidatePath("/meds");
  revalidatePath("/");
  redirect("/meds/manage");
}

export async function setDefinitionActive(definitionId: string, active: boolean) {
  const profile = await requireAdult();

  const updated = await prisma.taskDefinition.updateMany({
    where: { id: definitionId, householdId: profile.householdId, domain: "MED" },
    data: { active },
  });

  // Deactivating stops future roll-forward, but doesn't touch instances already on the
  // board — without this, already-generated future doses (up to 14 days out) would keep
  // showing as due even though the medication is now off. Reactivating regenerates from
  // today via the normal roll-forward, same as a brand-new definition would.
  if (updated.count > 0 && !active) {
    await prisma.taskInstance.deleteMany({
      where: { definitionId, status: "PENDING", dueDate: { gte: atMidnight(new Date()) } },
    });
  }

  revalidatePath("/meds");
  revalidatePath("/meds/manage");
}

/**
 * Raises quantityOnHand after a pharmacy pickup — the smallest item in this phase, and the
 * one that keeps the refill hook (see completeInstance) from re-nagging indefinitely.
 *
 * A plain `<form action>` with no useActionState (see the manage page), so it has nowhere
 * to show a returned `{ error }` — a thrown error here would surface on
 * app/(app)/error.tsx's full-panel boundary instead, which Phase 5/6 already learned to
 * avoid for exactly this shape of low-stakes convenience action. Invalid input is
 * therefore a silent no-op, not a throw: the HTML5 `min`/`required` attributes make it hard
 * to submit garbage by accident, and this is the server-side backstop for someone bypassing
 * the form, not a user-facing validation path.
 */
export async function addStock(definitionId: string, formData: FormData) {
  const profile = await requireAdult();
  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return;

  const definition = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: profile.householdId, domain: "MED" },
    select: { medication: { select: { id: true } } },
  });
  if (!definition?.medication) return;

  // Guards against quantityOnHand being null (tracking not configured, or cleared since the
  // page loaded) — {increment} against a null column is a silent no-op in Postgres, which
  // would otherwise look identical to success.
  const { count } = await prisma.medication.updateMany({
    where: { id: definition.medication.id, quantityOnHand: { not: null } },
    data: { quantityOnHand: { increment: amount } },
  });
  if (count === 0) return;

  revalidatePath("/meds/manage");
}

/**
 * Points go to whoever the dose was for, not whoever marked it done — the point is to
 * motivate the kid taking it, including when a parent confirms it on their behalf.
 *
 * Uses an atomic `status: "PENDING"` guard inside the transaction (not the earlier
 * `findUnique` + unconditional update) so two near-simultaneous completions of the same
 * dose can't both succeed — the second `updateMany` matches zero rows and the whole
 * transaction becomes a no-op instead of awarding double points and double-decrementing
 * quantityOnHand.
 */
export async function completeInstance(instanceId: string) {
  const profile = await requireActiveProfile();

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: { include: { medication: true } } },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "MED") {
    throw new Error("Medication dose not found");
  }
  assertOwnRecord(profile, instance.assignedToId);

  const pointsRecipient = instance.assignedToId ?? profile.id;
  const now = new Date();
  const medication = instance.definition.medication;
  const consumed = doseConsumption(medication?.quantityOnHand ?? null, medication?.doseAmount ?? null);

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "PENDING" },
      data: { status: "DONE", completedAt: now, completedById: profile.id, quantityConsumed: consumed },
    });
    if (count === 0) return { completed: false, needsRefill: false };

    await tx.pointsLedger.create({
      data: {
        personId: pointsRecipient,
        delta: instance.definition.points,
        reason: instance.definition.title,
        instanceId: instance.id,
      },
    });

    let needsRefill = false;
    if (consumed != null && medication) {
      // needsRefill is judged against the row THIS decrement produced, not the
      // pre-transaction snapshot — a concurrent second dose or addStock landing between
      // the initial read and this write would otherwise make the trigger fire (or not)
      // based on a value that's already stale by the time it matters.
      const updated = await tx.medication.update({
        where: { id: medication.id },
        data: { quantityOnHand: { decrement: consumed } },
      });
      needsRefill = isLowStock(updated.quantityOnHand, medication.refillThresholdQuantity);
    }

    return { completed: true, needsRefill };
  });

  // Post-commit, best-effort — a refill reminder is a convenience; the dose completion
  // itself must never fail because the shopping list did. A level trigger: this fires
  // again on the NEXT dose after the refill item is bought and cleared, until
  // quantityOnHand is raised back above the threshold (via addStock or the edit form) —
  // deliberate, not a bug, so a stale low count doesn't silently stop nagging.
  if (result.completed && result.needsRefill) {
    try {
      const { created } = await requestItemByName({
        householdId: profile.householdId,
        name: instance.definition.title,
        addedById: profile.id,
        requestedById: instance.assignedToId,
      });
      if (created) revalidatePath("/groceries");
    } catch (err) {
      console.error("[meds] failed to request a refill shopping-list item", err);
      captureError(err);
    }
  }

  revalidatePath("/meds");
  revalidatePath("/meds/manage");
  revalidatePath("/");
}

export async function uncompleteInstance(instanceId: string) {
  const profile = await requireActiveProfile();

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: { include: { medication: true } } },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "MED") {
    throw new Error("Medication dose not found");
  }
  assertOwnRecord(profile, instance.completedById);

  const medication = instance.definition.medication;
  // Restores exactly what THIS dose consumed, captured at completion time — not the
  // definition's current doseAmount, which may have been edited since. See
  // TaskInstance.quantityConsumed's schema doc comment.
  const restoreAmount = instance.quantityConsumed;

  await prisma.$transaction(async (tx) => {
    // Pins completedAt, not just status: "DONE" — undoing THE COMPLETION I SAW, not
    // "whatever's currently DONE." Without this, two overlapping undo attempts could race
    // a completed-again-in-between instance (rare, but the same class of gap the
    // status-guard above exists to close for complete/complete).
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "DONE", completedAt: instance.completedAt },
      data: { status: "PENDING", completedAt: null, completedById: null, quantityConsumed: null },
    });
    if (count === 0) return;

    await tx.pointsLedger.deleteMany({ where: { instanceId: instance.id } });

    if (restoreAmount != null && medication) {
      await tx.medication.update({
        where: { id: medication.id },
        data: { quantityOnHand: { increment: restoreAmount } },
      });
    }
  });

  revalidatePath("/meds");
  revalidatePath("/meds/manage");
  revalidatePath("/");
}

/** Proxies RxTerms so the browser never calls a third party directly and a lookup failure
 * can't break form submission — the client just gets an empty suggestion list. */
export async function searchMedicationNames(query: string): Promise<string[]> {
  await requireActiveProfile();
  return searchRxTerms(query);
}

/**
 * A grown-up's "Skip" / "Missed" (lib/tasks/skip.ts): nobody did it, so nobody gets stickers and
 * no stock is used. Kids can't: skipping is how a missed dose would quietly disappear.
 */
export async function skipInstance(instanceId: string) {
  const profile = await requireAdult();
  if (await skipTask({ householdId: profile.householdId, domain: "MED", instanceId, byId: profile.id })) revalidateBoard();
}

export async function unskipInstance(instanceId: string) {
  const profile = await requireAdult();
  if (await unskipTask({ householdId: profile.householdId, domain: "MED", instanceId })) revalidateBoard();
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
  if (await markOlderTasksMissed({ householdId: profile.householdId, domain: "MED", byId: profile.id, personId: who })) revalidateBoard();
}

function revalidateBoard() {
  revalidatePath("/meds");
  revalidatePath("/");
}
