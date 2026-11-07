"use server";

import { assertAppOn } from "@/lib/app-guard";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult, requireAdult } from "@/lib/authz";
import { ASSIGNMENT_KINDS, parseAssignmentDetails, parseAssignmentForm, parseGrade, parseProfileForm, parseTaskForm, type AssignmentKindValue } from "@/lib/school/form";
import { canEditAssignmentDetails, canRemoveAssignment, canSeeStudent } from "@/lib/school/permissions";
import { setAssignmentStatusIn, setTaskDoneIn } from "@/lib/school/cores";
import { BULK_TIMEOUT_MS, summarize, type BulkResult } from "@/lib/work-items/bulk";
import { bulkSchema } from "@/lib/work-items/bulk-schema";
import { deleteEventsFor, recordEvent, recordEvents } from "@/lib/work-items/events";
import { assignmentChanges, putBackValues, taskChanges } from "@/lib/work-items/changes";
import { parseLocalDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * School (Phase 18). Adults manage everything. A kid can add, tick off and delete their
 * own homework (not grades, not "missing", not anyone else's). Every id from the browser is
 * checked against the household.
 */
export type SchoolFormState = { error?: string; notice?: string };

function revalidateSchool() {
  revalidatePath("/school");
  revalidatePath("/");
}

async function householdMember(householdId: string, personId: string) {
  return prisma.person.findFirst({ where: { id: personId, householdId, isHouseholdMember: true }, select: { id: true } });
}

async function ownProfile(householdId: string, personId: string) {
  return prisma.schoolProfile.findFirst({ where: { personId, person: { householdId } }, select: { id: true } });
}

export async function saveProfile(personId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  if (!(await householdMember(profile.householdId, personId))) return { error: "That family member wasn't found." };
  const parsed = parseProfileForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  await prisma.schoolProfile.upsert({ where: { personId }, create: { personId, ...parsed.fields }, update: parsed.fields });
  revalidateSchool();
  return { notice: "Saved." };
}

const contactSchema = z.object({
  role: z.string().trim().min(1, "What's their role? e.g. Homeroom teacher").max(80),
  existingPersonId: z.string().trim(),
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
  email: z.union([z.literal(""), z.email("That email doesn't look right")]),
  phone: z.string().trim().max(40),
});

/** Links a teacher/office contact: an existing People contact, or a new one made here. */
export async function addSchoolContact(profileId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  const school = await prisma.schoolProfile.findFirst({ where: { id: profileId, person: { householdId: profile.householdId } }, select: { id: true } });
  if (!school) return { error: "Add the school details first." };
  const parsed = contactSchema.safeParse(Object.fromEntries(["role", "existingPersonId", "firstName", "lastName", "email", "phone"].map((k) => [k, String(fd.get(k) ?? "").trim()])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const f = parsed.data;

  let personId = f.existingPersonId;
  if (personId) {
    // A contact, not a family member: the same list the form offers.
    const found = await prisma.person.findFirst({
      where: { id: personId, householdId: profile.householdId, isHouseholdMember: false },
      select: { id: true },
    });
    if (!found) return { error: "That contact wasn't found." };
  } else {
    if (!f.firstName) return { error: "Pick a contact, or enter a name for a new one." };
    const created = await prisma.person.create({
      data: {
        householdId: profile.householdId,
        firstName: f.firstName,
        lastName: f.lastName || null,
        email: f.email || null,
        phone: f.phone || null,
        isHouseholdMember: false,
      },
    });
    personId = created.id;
  }
  await prisma.schoolContact.upsert({
    where: { profileId_personId: { profileId, personId } },
    create: { profileId, personId, role: f.role },
    update: { role: f.role },
  });
  revalidateSchool();
  return { notice: "Added." };
}

export async function removeSchoolContact(profileId: string, personId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  await prisma.schoolContact.deleteMany({ where: { profileId, personId, profile: { person: { householdId: profile.householdId } } } });
  revalidateSchool();
}

export async function addTask(_prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  const parsed = parseTaskForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { kidPersonId, ownerPersonId } = parsed.fields;
  for (const id of [kidPersonId, ownerPersonId]) {
    if (id && !(await householdMember(profile.householdId, id))) return { error: "That family member wasn't found." };
  }
  await prisma.schoolTask.create({ data: { householdId: profile.householdId, ...parsed.fields } });
  revalidateSchool();
  return { notice: "Added." };
}

export async function setTaskDone(taskId: string, done: boolean) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  await prisma.$transaction((tx) => setTaskDoneIn(tx, profile, taskId, done));
  revalidateSchool();
}

/** The status pill's form of setTaskDone (Phase 59.1a). */
export async function setTaskStatus(taskId: string, status: "OPEN" | "DONE") {
  if (status !== "OPEN" && status !== "DONE") throw new Error("Unknown status");
  await setTaskDone(taskId, status === "DONE");
}

export async function deleteTask(taskId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.schoolTask.deleteMany({ where: { id: taskId, householdId: profile.householdId } });
    if (count > 0) await deleteEventsFor(tx, "SCHOOL_TASK", [taskId]);
  });
  revalidateSchool();
}

export async function addAssignment(personId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireActiveProfile();
  await assertAppOn(viewer.householdId, "school");
  if (!canSeeStudent(viewer, personId)) return { error: "You can only add your own homework." };
  const school = await ownProfile(viewer.householdId, personId);
  if (!school) return { error: "Add the school details first." };
  const parsed = parseAssignmentForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  // Grades and "missing" come from a grown-up.
  const fields = isAdult(viewer) ? parsed.fields : { ...parsed.fields, score: null, maxScore: null, status: parsed.fields.status === "DONE" ? "DONE" as const : "TODO" as const };
  await prisma.schoolAssignment.create({
    data: { profileId: school.id, ...fields, doneAt: fields.status === "DONE" ? new Date() : null },
  });
  revalidateSchool();
  return { notice: "Added." };
}

async function findAssignment(viewer: { householdId: string; id: string; role: "ADMIN" | "ADULT" | "KID" | null }, assignmentId: string) {
  const a = await prisma.schoolAssignment.findFirst({
    where: { id: assignmentId, profile: { person: { householdId: viewer.householdId } } },
    select: { id: true, doneAt: true, status: true, score: true, profile: { select: { personId: true } } },
  });
  return a && canSeeStudent(viewer, a.profile.personId) ? a : null;
}

export async function setAssignmentStatus(assignmentId: string, status: "TODO" | "DONE" | "MISSING") {
  const viewer = await requireActiveProfile();
  await assertAppOn(viewer.householdId, "school");
  if (!["TODO", "DONE", "MISSING"].includes(status)) throw new Error("Unknown status");
  const result = await prisma.$transaction((tx) => setAssignmentStatusIn(tx, viewer, assignmentId, status));
  if (!result.ok && result.reason === "not found") throw new Error("Assignment not found");
  if (!result.ok && result.reason === "not allowed") throw new Error("Ask a grown-up to change that one");
  revalidateSchool();
}

/** Adults: the full edit, including the grade. */
export async function updateAssignment(assignmentId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireAdult();
  await assertAppOn(viewer.householdId, "school");
  const existing = await findAssignment(viewer, assignmentId);
  if (!existing) return { error: "Assignment not found." };
  const parsed = parseAssignmentForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.schoolAssignment.findUnique({ where: { id: assignmentId } });
    if (!before) return "gone" as const;
    // Only over what was read, so the history's "from" is true: an edit that landed in between
    // asks for a reload instead of being overwritten.
    const { count } = await tx.schoolAssignment.updateMany({
      where: { id: assignmentId, updatedAt: before.updatedAt },
      // Editing the grade later mustn't move when it was finished. A grown-up's own edit counts
      // as checking a kid's change (Phase 59.2a).
      data: { ...parsed.fields, doneAt: parsed.fields.status === "DONE" ? (before.doneAt ?? new Date()) : null, kidChangedAt: null },
    });
    if (count === 0) return "changed" as const;
    await recordEvents(tx, [
      ...assignmentChanges(before, parsed.fields).map((c) => ({ ...c, householdId: viewer.householdId, itemId: assignmentId, actorId: viewer.id })),
      ...reviewed(before, viewer, assignmentId),
    ]);
    return "saved" as const;
  });
  if (saved === "gone") return { error: "Assignment not found." };
  if (saved === "changed") return { error: "Someone changed this one just now. Reload the page and try again." };
  revalidateSchool();
  return { notice: "Saved." };
}

export async function deleteAssignment(assignmentId: string) {
  const viewer = await requireActiveProfile();
  await assertAppOn(viewer.householdId, "school");
  const existing = await findAssignment(viewer, assignmentId);
  if (!existing) throw new Error("Assignment not found");
  // Kids can remove their own homework, not a grade or a "missing" a grown-up recorded.
  if (!canRemoveAssignment(viewer, { studentId: existing.profile.personId, status: existing.status, score: existing.score })) {
    throw new Error("Ask a grown-up to remove that one");
  }
  await prisma.$transaction(async (tx) => {
    await tx.schoolAssignment.delete({ where: { id: assignmentId } });
    await deleteEventsFor(tx, "ASSIGNMENT", [assignmentId]);
  });
  revalidateSchool();
}

// ---- Phase 59.2a: change things in place ----------------------------------------------------

/** A grown-up's own edit of a flagged assignment checks the kid's change: one APPROVE event. */
function reviewed(before: { kidChangedAt: Date | null }, viewer: { id: string; householdId: string }, itemId: string) {
  return before.kidChangedAt ? [{ householdId: viewer.householdId, itemType: "ASSIGNMENT" as const, itemId, actorId: viewer.id, action: "APPROVE" as const }] : [];
}

const CHANGED_MEANWHILE = "Someone changed this one just now. Reload the page and try again.";

/**
 * The quick edit of an assignment's title, class, type and due date. A grown-up may change any;
 * a kid their own work that isn't missing or graded (the owner's call, 2026-11-07), and then a
 * grown-up sees it flagged to approve or put back.
 */
export async function setAssignmentDetails(assignmentId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireActiveProfile();
  await assertAppOn(viewer.householdId, "school");
  const parsed = parseAssignmentDetails(fd);
  if (!parsed.ok) return { error: parsed.error };
  const kid = !isAdult(viewer);
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.schoolAssignment.findFirst({
      where: { id: assignmentId, profile: { person: { householdId: viewer.householdId } } },
      include: { profile: { select: { personId: true } } },
    });
    if (!before || !canEditAssignmentDetails(viewer, { studentId: before.profile.personId, status: before.status, score: before.score })) return "refused" as const;
    const changes = assignmentChanges(before, { ...before, ...parsed.fields });
    // A grown-up saving a flagged one unchanged still counts as checking it, like the full edit.
    if (changes.length === 0 && (kid || !before.kidChangedAt)) return "same" as const;
    const { count } = await tx.schoolAssignment.updateMany({
      where: { id: assignmentId, updatedAt: before.updatedAt },
      data: { ...parsed.fields, kidChangedAt: kid ? new Date() : null },
    });
    if (count === 0) return "changed" as const;
    await recordEvents(tx, [
      ...changes.map((c) => ({ ...c, householdId: viewer.householdId, itemId: assignmentId, actorId: viewer.id })),
      ...(kid ? [] : reviewed(before, viewer, assignmentId)),
    ]);
    return "saved" as const;
  });
  if (result === "refused") return { error: kid ? "Ask a grown-up to change that one." : "Assignment not found." };
  if (result === "changed") return { error: CHANGED_MEANWHILE };
  revalidateSchool();
  return { notice: "Saved." };
}

/** Grown-ups: the score and what it's out of, from the row. */
export async function gradeAssignment(assignmentId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireAdult();
  await assertAppOn(viewer.householdId, "school");
  const parsed = parseGrade(fd);
  if (!parsed.ok) return { error: parsed.error };
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.schoolAssignment.findFirst({ where: { id: assignmentId, profile: { person: { householdId: viewer.householdId } } } });
    if (!before) return "gone" as const;
    // Graded work has been turned in (the owner's call): a score on To do work marks it done too.
    const turnIn = parsed.fields.score != null && before.status === "TODO";
    const after = { ...parsed.fields, ...(turnIn ? { status: "DONE" as const, doneAt: before.doneAt ?? new Date() } : {}) };
    const changes = assignmentChanges(before, { ...before, ...after });
    if (changes.length === 0) return "same" as const;
    const { count } = await tx.schoolAssignment.updateMany({ where: { id: assignmentId, updatedAt: before.updatedAt }, data: { ...after, kidChangedAt: null } });
    if (count === 0) return "changed" as const;
    await recordEvents(tx, [
      ...changes.map((c) => ({ ...c, householdId: viewer.householdId, itemId: assignmentId, actorId: viewer.id })),
      ...reviewed(before, viewer, assignmentId),
    ]);
    return "saved" as const;
  });
  if (result === "gone") return { error: "Assignment not found." };
  if (result === "changed") return { error: CHANGED_MEANWHILE };
  revalidateSchool();
  return { notice: "Saved." };
}

/** The kid's change the grown-up was looking at, by when it was made (an ISO string from the page). */
function seenChange(seen: string): Date {
  const at = new Date(seen);
  if (typeof seen !== "string" || Number.isNaN(at.getTime())) throw new Error("Unknown change");
  return at;
}

/**
 * Grown-ups: a kid's change is fine as it is. Only the change they saw: if the kid changed it
 * again since, this does nothing and the row says to refresh.
 */
export async function approveKidChange(assignmentId: string, seen: string) {
  const viewer = await requireAdult();
  await assertAppOn(viewer.householdId, "school");
  const at = seenChange(seen);
  const approved = await prisma.$transaction(async (tx) => {
    const { count } = await tx.schoolAssignment.updateMany({
      where: { id: assignmentId, kidChangedAt: at, profile: { person: { householdId: viewer.householdId } } },
      data: { kidChangedAt: null },
    });
    if (count > 0) await recordEvent(tx, { householdId: viewer.householdId, itemType: "ASSIGNMENT", itemId: assignmentId, actorId: viewer.id, action: "APPROVE" });
    return count > 0;
  });
  if (!approved) throw new Error("That change has changed; refresh the page");
  revalidateSchool();
}

/**
 * Grown-ups: undo a kid's changes since the last review, back to what each field was before
 * their first change (from the history, lib/work-items/changes.ts's putBackValues).
 */
export async function putBackKidChange(assignmentId: string, seen: string) {
  const viewer = await requireAdult();
  await assertAppOn(viewer.householdId, "school");
  const at = seenChange(seen);
  const done = await prisma.$transaction(async (tx) => {
    const a = await tx.schoolAssignment.findFirst({
      where: { id: assignmentId, kidChangedAt: at, profile: { person: { householdId: viewer.householdId } } },
      include: { profile: { select: { personId: true } } },
    });
    if (!a) return false;
    // Ties broken by id (time-ordered), since one save's events share a moment.
    const events = await tx.workItemEvent.findMany({ where: { itemType: "ASSIGNMENT", itemId: assignmentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const back = putBackValues(events, a.profile.personId);
    const data: { title?: string; className?: string; kind?: AssignmentKindValue; dueDate?: Date | null } = {};
    // Title and class are required, so an empty one in history is never put back; a due date can
    // genuinely have been blank, so null puts it back to none, and only an unreadable one is skipped.
    if (back.title) data.title = back.title;
    if (back.className) data.className = back.className;
    if (back.kind && (ASSIGNMENT_KINDS as readonly string[]).includes(back.kind)) data.kind = back.kind as AssignmentKindValue;
    if ("dueDate" in back) {
      const day = back.dueDate ? parseLocalDate(back.dueDate) : null;
      if (day || back.dueDate == null) data.dueDate = day;
    }
    const changes = assignmentChanges(a, { ...a, ...data });
    // Pinned to the row read, so a kid's save landing in between isn't overwritten unseen.
    const { count } = await tx.schoolAssignment.updateMany({ where: { id: assignmentId, updatedAt: a.updatedAt }, data: { ...data, kidChangedAt: null } });
    if (count === 0) return false;
    await recordEvents(
      tx,
      changes.map((c) => ({ ...c, action: "PUT_BACK" as const, householdId: viewer.householdId, itemId: assignmentId, actorId: viewer.id })),
    );
    // Nothing left to restore still counts as reviewed.
    if (changes.length === 0) await recordEvent(tx, { householdId: viewer.householdId, itemType: "ASSIGNMENT", itemId: assignmentId, actorId: viewer.id, action: "PUT_BACK" });
    return true;
  });
  if (!done) throw new Error("That change has changed; refresh the page");
  revalidateSchool();
}

/** Grown-ups: a form, fee or to-do's full edit. */
export async function updateTask(taskId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  const parsed = parseTaskForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { kidPersonId, ownerPersonId } = parsed.fields;
  const names = new Map<string, string>();
  for (const id of [kidPersonId, ownerPersonId]) {
    if (!id) continue;
    const found = await prisma.person.findFirst({ where: { id, householdId: profile.householdId, isHouseholdMember: true }, select: { id: true, firstName: true } });
    if (!found) return { error: "That family member wasn't found." };
    names.set(found.id, found.firstName);
  }
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.schoolTask.findFirst({
      where: { id: taskId, householdId: profile.householdId },
      include: { kid: { select: { firstName: true } }, owner: { select: { firstName: true } } },
    });
    if (!before) return "gone" as const;
    const money = (c: number | null) => (c == null ? null : formatMoney(c));
    const changes = taskChanges(
      { title: before.title, kind: before.kind, kid: before.kid?.firstName ?? null, owner: before.owner?.firstName ?? null, dueDate: before.dueDate, amount: money(before.amountCents), notes: before.notes },
      {
        title: parsed.fields.title,
        kind: parsed.fields.kind,
        kid: kidPersonId ? names.get(kidPersonId)! : null,
        owner: ownerPersonId ? names.get(ownerPersonId)! : null,
        dueDate: parsed.fields.dueDate,
        amount: money(parsed.fields.amountCents),
        notes: parsed.fields.notes,
      },
    );
    if (changes.length === 0) return "same" as const;
    const { count } = await tx.schoolTask.updateMany({ where: { id: taskId, updatedAt: before.updatedAt }, data: parsed.fields });
    if (count === 0) return "changed" as const;
    await recordEvents(tx, changes.map((c) => ({ ...c, householdId: profile.householdId, itemId: taskId, actorId: profile.id })));
    return "saved" as const;
  });
  if (result === "gone") return { error: "That one wasn't found." };
  if (result === "changed") return { error: CHANGED_MEANWHILE };
  revalidateSchool();
  return { notice: "Saved." };
}

/** Grown-ups: "I've got it", in one tap. */
export async function claimTask(taskId: string) {
  const profile = await requireAdult();
  await assertAppOn(profile.householdId, "school");
  await prisma.$transaction(async (tx) => {
    const before = await tx.schoolTask.findFirst({ where: { id: taskId, householdId: profile.householdId }, include: { owner: { select: { firstName: true } } } });
    if (!before || before.ownerPersonId === profile.id) return;
    const { count } = await tx.schoolTask.updateMany({ where: { id: taskId, ownerPersonId: before.ownerPersonId }, data: { ownerPersonId: profile.id } });
    if (count === 0) return;
    await recordEvent(tx, { householdId: profile.householdId, itemType: "SCHOOL_TASK", itemId: taskId, actorId: profile.id, action: "ASSIGN", fromValue: before.owner?.firstName ?? null, toValue: profile.firstName });
  });
  revalidateSchool();
}

// ---- Phase 59.3: pick several, act once -----------------------------------------------------

const schoolBulk = bulkSchema(["TODO", "DONE", "MISSING", "FORM_DONE"] as const);

/**
 * Grown-ups: one status for up to 30 assignments (or forms done), in one transaction, each through
 * the same core as a single tap. One a rule refuses is skipped and counted.
 */
export async function bulkSchool(input: unknown): Promise<BulkResult | { error: string }> {
  const viewer = await requireAdult();
  await assertAppOn(viewer.householdId, "school");
  const parsed = schoolBulk.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That didn't look right." };
  const { ids, action } = parsed.data;
  const results = await prisma.$transaction(async (tx) => {
    const out: Parameters<typeof summarize>[0] = [];
    for (const id of ids) out.push(action === "FORM_DONE" ? await setTaskDoneIn(tx, viewer, id, true) : await setAssignmentStatusIn(tx, viewer, id, action));
    return out;
  }, { timeout: BULK_TIMEOUT_MS });
  revalidateSchool();
  return summarize(results);
}
