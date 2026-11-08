"use server";

import { assertAppOn } from "@/lib/app-guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { requireAdult, assertOwnRecord } from "@/lib/authz";
import { atMidnight } from "@/lib/tasks/schedule";
import { doseConsumption } from "@/lib/meds/quantity";
import { addToStock, takeStock } from "@/lib/meds/stock";
import { isMedLow } from "@/lib/reminders/supply";
import { canTakeYet } from "@/lib/meds/dose-window";
import { nextAllowed, notYetWords, whenWords } from "@/lib/meds/as-needed";
import { searchRxTerms } from "@/lib/meds/rxterms";
import { courseEnd, medFormSchema } from "@/lib/meds/form";
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
    minGapHours: numOrUndefined("minGapHours"),
    maxPerDay: numOrUndefined("maxPerDay"),
    prescriberId: idOrUndefined("prescriberId"),
    pharmacyId: idOrUndefined("pharmacyId"),
    endMode: String(formData.get("endMode") ?? "never") || "never",
    endDays: numOrUndefined("endDays"),
    endDate: idOrUndefined("endDate"),
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
    minGapHours,
    maxPerDay,
    prescriberId,
    pharmacyId,
    endMode,
    endDays,
    endDate,
    ...rest
  } = parsed.data;
  const end = courseEnd({ frequencyType: rest.frequencyType, startDate: rest.startDate, endMode, endDays, endDate });
  if ("error" in end) return { error: end.error } as const;
  const asNeeded = rest.frequencyType === "AS_NEEDED";
  // An as-needed medicine has no times; its limits mean nothing on a schedule.
  const dedupedTimes = asNeeded ? [] : Array.from(new Set(timesOfDay)).sort();

  return {
    fields: { ...rest, notes: notes || null, interval: interval ?? null, timesOfDay: dedupedTimes, endDate: end.endDate },
    assigneeIds,
    medFields: {
      quantityOnHand: quantityOnHand ?? null,
      doseAmount: doseAmount ?? null,
      refillThresholdQuantity: refillThresholdQuantity ?? null,
      minGapHours: asNeeded ? (minGapHours ?? null) : null,
      maxPerDay: asNeeded ? (maxPerDay ?? null) : null,
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
  await assertAppOn(profile.householdId, "meds");
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
  await assertAppOn(profile.householdId, "meds");
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
    // Phase 65a: switching to As needed drops every waiting dose, overdue ones too: nothing would
    // show them or clear them again.
    prisma.taskInstance.deleteMany({
      where: { definitionId, status: "PENDING", ...(result.fields.frequencyType === "AS_NEEDED" ? {} : { dueDate: { gte: atMidnight(new Date()) } }) },
    }),
  ]);

  revalidatePath("/meds");
  revalidatePath("/");
  redirect("/meds/manage");
}

export async function setDefinitionActive(definitionId: string, active: boolean) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "meds");

  const updated = await prisma.taskDefinition.updateMany({
    where: { id: definitionId, householdId: profile.householdId, domain: "MED" },
    data: { active },
  });
  // Phase 68a: turning a finished course back on means it goes on: its past end day goes too, or
  // the next tick would switch it off again. A course whose end is still ahead keeps it.
  if (active) {
    await prisma.taskDefinition.updateMany({
      where: { id: definitionId, householdId: profile.householdId, domain: "MED", endDate: { lt: atMidnight(new Date()) } },
      data: { endDate: null },
    });
  }

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
  await assertAppOn(profile.householdId, "meds");
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
  // Rounded in SQL (lib/meds/stock.ts), and a no-op on an uncounted medicine.
  if (!(await addToStock(prisma, definition.medication.id, amount))) return;

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
  await assertAppOn(profile.householdId, "meds");

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: { include: { medication: true } } },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "MED") {
    throw new Error("Medication dose not found");
  }
  // Phase 65a: an as-needed dose is taken and undone by its own actions (undo deletes it).
  if (instance.definition.frequencyType === "AS_NEEDED") throw new Error("Use the as-needed actions");
  assertOwnRecord(profile, instance.assignedToId);
  // Phase 60: not ahead of its day (Upcoming hides Taken; this is for a stale page).
  if (!canTakeYet(instance.dueDate)) throw new Error("That dose isn't due yet");

  const pointsRecipient = instance.assignedToId ?? profile.id;
  const now = new Date();
  const medication = instance.definition.medication;

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.taskInstance.updateMany({
      where: { id: instanceId, status: "PENDING" },
      data: { status: "DONE", completedAt: now, completedById: profile.id },
    });
    if (count === 0) return { completed: false, needsRefill: false };
    // Phase 66a: the count and dose amount as they are now, like takeAsNeeded, not as the page
    // was loaded (a count set or a dose amount changed in between would be missed).
    const fresh = medication ? await tx.medication.findUnique({ where: { id: medication.id } }) : null;
    const consumed = doseConsumption(fresh?.quantityOnHand ?? null, fresh?.doseAmount ?? null);

    await tx.pointsLedger.create({
      data: {
        personId: pointsRecipient,
        delta: instance.definition.points,
        reason: instance.definition.title,
        instanceId: instance.id,
      },
    });

    let needsRefill = false;
    if (consumed != null && fresh) {
      // needsRefill is judged against the row THIS decrement produced, not the
      // pre-transaction snapshot — a concurrent second dose or addStock landing between
      // the initial read and this write would otherwise make the trigger fire (or not)
      // based on a value that's already stale by the time it matters.
      // Phase 66a: clamped at zero and rounded; the dose records what was really taken, so Undo
      // gives back exactly that, and low is the reminder's rule (lib/reminders/supply.ts).
      const stock = await takeStock(tx, fresh.id, consumed);
      if (stock) {
        await tx.taskInstance.update({ where: { id: instanceId }, data: { quantityConsumed: stock.taken } });
        needsRefill = lowAfter(instance.definition, fresh, stock.after);
      }
    }

    return { completed: true, needsRefill };
  });

  // Post-commit, best-effort — a refill reminder is a convenience; the dose completion
  // itself must never fail because the shopping list did. A level trigger: this fires
  // again on the NEXT dose after the refill item is bought and cleared, until the stock is
  // no longer low (isMedLow: raised via addStock, the edit form or a trip) — deliberate, not
  // a bug, so a stale low count doesn't silently stop nagging.
  if (result.completed && result.needsRefill) {
    await requestRefill({ householdId: profile.householdId, title: instance.definition.title, byId: profile.id, forId: instance.assignedToId, medicationId: medication?.id ?? null });
  }

  revalidatePath("/meds");
  revalidatePath("/meds/manage");
  revalidatePath("/");
}

/** A "Refill <medicine>" list item, best effort: the dose itself never fails because the list did. */
async function requestRefill(o: { householdId: string; title: string; byId: string; forId: string | null; medicationId: string | null }) {
  try {
    const { created } = await requestItemByName({
      householdId: o.householdId,
      name: o.title,
      addedById: o.byId,
      requestedById: o.forId,
      // Phase 63a: the list remembers which medicine, so finishing the trip can restock it.
      ...(o.medicationId ? { source: { medicationId: o.medicationId } } : {}),
    });
    if (created) revalidatePath("/groceries");
  } catch (err) {
    captureError(err, "meds.refill_item_failed");
  }
}

export type DoseState = { error?: string; ok?: string };

/** Low after a dose, on the running-low reminder's rule (Phase 66a), judged on the row just written. */
function lowAfter(
  definition: { frequencyType: string; interval: number | null; daysOfWeek: number[]; timesOfDay: string[] },
  medication: { doseAmount: number | null; refillThresholdQuantity: number | null },
  quantityOnHand: number,
): boolean {
  return isMedLow({
    quantityOnHand,
    doseAmount: medication.doseAmount,
    refillThresholdQuantity: medication.refillThresholdQuantity,
    frequencyType: definition.frequencyType,
    interval: definition.interval ?? 1,
    daysOfWeek: definition.daysOfWeek,
    timesOfDay: definition.timesOfDay,
  }).low;
}

/**
 * Phase 65a: takes a dose of an as-needed medicine now. Who may: as for a scheduled dose (the
 * medicine's person, or a grown-up). The gap and the daily maximum are checked inside the
 * transaction, with the medicine's row locked, so two people logging seconds apart can't both
 * get past them. Stock, stickers and the refill item work as for a scheduled dose.
 */
export async function takeAsNeeded(definitionId: string): Promise<DoseState> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "meds");
  if (typeof definitionId !== "string" || definitionId.length > 64) return { error: "That medicine isn't here anymore." };
  const definition = await prisma.taskDefinition.findFirst({
    where: { id: definitionId, householdId: profile.householdId, domain: "MED", frequencyType: "AS_NEEDED", active: true },
    include: { medication: true, assignees: { select: { id: true } } },
  });
  if (!definition) return { error: "That medicine isn't here anymore." };
  const forId = definition.assignees[0]?.id ?? null;
  try {
    assertOwnRecord(profile, forId);
  } catch {
    return { error: "Only a grown-up can log someone else's medicine." };
  }
  const medication = definition.medication;
  const rules = { minGapHours: medication?.minGapHours ?? null, maxPerDay: medication?.maxPerDay ?? null };

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "task_definition" WHERE id = ${definition.id} FOR UPDATE`;
    const now = new Date();
    const recent = await tx.taskInstance.findMany({
      where: { definitionId: definition.id, status: "DONE", completedAt: { gt: new Date(now.getTime() - 24 * 3_600_000 - Math.max(0, (rules.minGapHours ?? 0) - 24) * 3_600_000) } },
      select: { completedAt: true },
    });
    const next = nextAllowed(recent.map((r) => r.completedAt!), rules, now);
    if (!next.ok) return { error: notYetWords(next, rules, now) };
    const fresh = medication ? await tx.medication.findUnique({ where: { id: medication.id } }) : null;
    const consumed = doseConsumption(fresh?.quantityOnHand ?? null, fresh?.doseAmount ?? null);
    const dose = await tx.taskInstance.create({
      data: { definitionId: definition.id, dueDate: now, assignedToId: forId, status: "DONE", completedAt: now, completedById: profile.id },
    });
    await tx.pointsLedger.create({ data: { personId: forId ?? profile.id, delta: definition.points, reason: definition.title, instanceId: dose.id } });
    let needsRefill = false;
    if (consumed != null && medication) {
      const stock = await takeStock(tx, medication.id, consumed);
      if (stock) {
        await tx.taskInstance.update({ where: { id: dose.id }, data: { quantityConsumed: stock.taken } });
        needsRefill = lowAfter(definition, fresh ?? medication, stock.after);
      }
    }
    return { needsRefill, at: now };
  });
  if ("error" in result) return { error: result.error };
  if (result.needsRefill) await requestRefill({ householdId: profile.householdId, title: definition.title, byId: profile.id, forId, medicationId: medication?.id ?? null });
  revalidateBoard();
  return { ok: `Taken at ${whenWords(result.at, result.at)}.` };
}

/**
 * Phase 65a: undoes an as-needed dose by removing it (it was never scheduled; put back to waiting
 * it would look like a dose to take, and a missed one). Stock and stickers go back.
 */
export async function undoAsNeeded(instanceId: string) {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "meds");
  const instance = await prisma.taskInstance.findUnique({ where: { id: instanceId }, include: { definition: { include: { medication: true } } } });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "MED" || instance.definition.frequencyType !== "AS_NEEDED") {
    throw new Error("Medication dose not found");
  }
  assertOwnRecord(profile, instance.completedById);
  const medication = instance.definition.medication;
  await prisma.$transaction(async (tx) => {
    await tx.pointsLedger.deleteMany({ where: { instanceId: instance.id } });
    const { count } = await tx.taskInstance.deleteMany({ where: { id: instance.id, status: "DONE" } });
    if (count && instance.quantityConsumed != null && medication) await addToStock(tx, medication.id, instance.quantityConsumed);
  });
  revalidateBoard();
}

export async function uncompleteInstance(instanceId: string) {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "meds");

  const instance = await prisma.taskInstance.findUnique({
    where: { id: instanceId },
    include: { definition: { include: { medication: true } } },
  });
  if (!instance || instance.definition.householdId !== profile.householdId || instance.definition.domain !== "MED") {
    throw new Error("Medication dose not found");
  }
  if (instance.definition.frequencyType === "AS_NEEDED") throw new Error("Use the as-needed actions");
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

    if (restoreAmount != null && medication) await addToStock(tx, medication.id, restoreAmount);
  });

  revalidatePath("/meds");
  revalidatePath("/meds/manage");
  revalidatePath("/");
}

/** Proxies RxTerms so the browser never calls a third party directly and a lookup failure
 * can't break form submission — the client just gets an empty suggestion list. */
export async function searchMedicationNames(query: string): Promise<string[]> {
  const profile = await requireActiveProfile();
  await assertAppOn(profile.householdId, "meds");
  return searchRxTerms(query);
}

/**
 * A grown-up's "Skip" / "Missed" (lib/tasks/skip.ts): nobody did it, so nobody gets stickers and
 * no stock is used. Kids can't: skipping is how a missed dose would quietly disappear.
 */
export async function skipInstance(instanceId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "meds");
  if (await skipTask({ householdId: profile.householdId, domain: "MED", instanceId, byId: profile.id })) revalidateBoard();
}

export async function unskipInstance(instanceId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "meds");
  if (await unskipTask({ householdId: profile.householdId, domain: "MED", instanceId })) revalidateBoard();
}

/**
 * Everything still waiting from before the overdue window (lib/tasks/skip.ts), in one go, for
 * the person the board is filtered to (or everyone). A person outside the household matches
 * nothing, since the definition is household-scoped.
 */
export async function markOlderMissed(personId: string | null) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "meds");
  // A malformed id does nothing, rather than falling back to everyone.
  if (personId !== null && (typeof personId !== "string" || personId.length === 0 || personId.length > 64)) return;
  const who = personId;
  if (await markOlderTasksMissed({ householdId: profile.householdId, domain: "MED", byId: profile.id, personId: who })) revalidateBoard();
}

function revalidateBoard() {
  revalidatePath("/meds");
  // Manage shows the stock count a dose changes.
  revalidatePath("/meds/manage");
  revalidatePath("/");
}
