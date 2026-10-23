"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult, requireAdult } from "@/lib/authz";
import { parseAssignmentForm, parseProfileForm, parseTaskForm } from "@/lib/school/form";
import { canSeeStudent } from "@/lib/school/queries";

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
  await prisma.schoolContact.deleteMany({ where: { profileId, personId, profile: { person: { householdId: profile.householdId } } } });
  revalidateSchool();
}

export async function addTask(_prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const profile = await requireAdult();
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
  await prisma.schoolTask.updateMany({
    where: { id: taskId, householdId: profile.householdId },
    data: { status: done ? "DONE" : "OPEN", doneAt: done ? new Date() : null },
  });
  revalidateSchool();
}

export async function deleteTask(taskId: string) {
  const profile = await requireAdult();
  await prisma.schoolTask.deleteMany({ where: { id: taskId, householdId: profile.householdId } });
  revalidateSchool();
}

export async function addAssignment(personId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireActiveProfile();
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
  if (status === "MISSING" && !isAdult(viewer)) throw new Error("Only a grown-up can mark work missing");
  const existing = await findAssignment(viewer, assignmentId);
  if (!existing) throw new Error("Assignment not found");
  // A teacher's "missing" is cleared by a grown-up, not by the student ticking it off.
  if (existing.status === "MISSING" && !isAdult(viewer)) throw new Error("Ask a grown-up to clear a missing assignment");
  await prisma.schoolAssignment.update({ where: { id: assignmentId }, data: { status, doneAt: status === "DONE" ? new Date() : null } });
  revalidateSchool();
}

/** Adults: the full edit, including the grade. */
export async function updateAssignment(assignmentId: string, _prev: SchoolFormState, fd: FormData): Promise<SchoolFormState> {
  const viewer = await requireAdult();
  const existing = await findAssignment(viewer, assignmentId);
  if (!existing) return { error: "Assignment not found." };
  const parsed = parseAssignmentForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  await prisma.schoolAssignment.update({
    where: { id: assignmentId },
    // Editing the grade later mustn't move when it was finished.
    data: { ...parsed.fields, doneAt: parsed.fields.status === "DONE" ? (existing.doneAt ?? new Date()) : null },
  });
  revalidateSchool();
  return { notice: "Saved." };
}

export async function deleteAssignment(assignmentId: string) {
  const viewer = await requireActiveProfile();
  const existing = await findAssignment(viewer, assignmentId);
  if (!existing) throw new Error("Assignment not found");
  // Kids can remove their own homework, not a grade or a "missing" a grown-up recorded.
  if (!isAdult(viewer) && (existing.score != null || existing.status === "MISSING")) throw new Error("Ask a grown-up to remove that one");
  await prisma.schoolAssignment.delete({ where: { id: assignmentId } });
  revalidateSchool();
}
