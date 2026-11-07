import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/roles";
import { canEditAssignmentDetails, canSeeStudent } from "@/lib/school/permissions";
import { toISODate } from "@/lib/format";
import { assignmentItem } from "./assignment";
import { choreItem } from "./chore";
import { schoolTaskItem } from "./school-task";
import { describeEvent, type ItemRef } from "./history";
import type { WorkItem } from "./types";

/**
 * Phase 59.4a: what the side panel shows for one item: its status pill, a few facts, what the
 * viewer may change, and its history in words. Whoever can see the item sees its history, and no
 * one else: a kid gets their own homework and chores that are theirs or anyone's; forms are a
 * grown-up's. Only first names and plain values leave here (it's drawn in the browser).
 */

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };

export type HistoryLine = { id: string; at: Date; who: string | null; text: string };

export type Panel =
  | { type: "CHORE"; item: WorkItem<"PENDING" | "DONE" | "SKIPPED">; facts: string[]; history: HistoryLine[] }
  | {
      type: "ASSIGNMENT";
      item: WorkItem<"TODO" | "DONE" | "MISSING">;
      facts: string[];
      history: HistoryLine[];
      details: { title: string; className: string; kind: "HOMEWORK" | "TEST" | "QUIZ" | "PROJECT"; dueDate: string } | null;
      grade: { score: string; maxScore: string } | null;
    }
  | {
      type: "SCHOOL_TASK";
      item: WorkItem<"OPEN" | "DONE">;
      facts: string[];
      history: HistoryLine[];
      edit: { title: string; kind: string; dueDate: string; amount: string; kidPersonId: string; ownerPersonId: string; notes: string };
    };

async function historyOf(ref: ItemRef): Promise<HistoryLine[]> {
  const events = await prisma.workItemEvent.findMany({
    where: { itemType: ref.type, itemId: ref.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    include: { actor: { select: { firstName: true } } },
  });
  return events.map((e) => ({ id: e.id, at: e.createdAt, who: e.actor?.firstName ?? null, text: describeEvent(e) }));
}

export async function getPanel(viewer: Viewer, ref: ItemRef, now: Date = new Date()): Promise<Panel | null> {
  const adult = isAdult(viewer);
  if (ref.type === "CHORE") {
    const i = await prisma.taskInstance.findFirst({
      where: { id: ref.id, definition: { householdId: viewer.householdId, domain: "CHORE" } },
      include: {
        definition: { select: { title: true, points: true, notes: true } },
        assignedTo: { select: { id: true, firstName: true } },
        completedBy: { select: { id: true, firstName: true } },
      },
    });
    if (!i) return null;
    if (!adult && i.assignedToId !== null && i.assignedToId !== viewer.id) return null;
    const item = choreItem(i, viewer, { skippable: adult, now });
    const facts = [i.assignedTo ? `For ${i.assignedTo.firstName}` : "Anyone can do it", i.definition.points ? `${i.definition.points} ⭐` : null, i.definition.notes].filter((f): f is string => Boolean(f));
    return { type: "CHORE", item, facts, history: await historyOf(ref) };
  }
  if (ref.type === "ASSIGNMENT") {
    const a = await prisma.schoolAssignment.findFirst({
      where: { id: ref.id, profile: { person: { householdId: viewer.householdId } } },
      include: { profile: { select: { person: { select: { id: true, firstName: true } } } } },
    });
    if (!a || !canSeeStudent(viewer, a.profile.person.id)) return null;
    const student = a.profile.person;
    const item = assignmentItem({ ...a, student }, viewer, now);
    const facts = [student.firstName, a.className, a.notes].filter((f): f is string => Boolean(f));
    const editable = canEditAssignmentDetails(viewer, { studentId: student.id, status: a.status, score: a.score });
    return {
      type: "ASSIGNMENT",
      item,
      facts,
      history: await historyOf(ref),
      details: editable ? { title: a.title, className: a.className, kind: a.kind, dueDate: a.dueDate ? toISODate(a.dueDate) : "" } : null,
      grade: adult ? { score: a.score?.toString() ?? "", maxScore: a.maxScore?.toString() ?? "" } : null,
    };
  }
  if (!adult) return null;
  const t = await prisma.schoolTask.findFirst({
    where: { id: ref.id, householdId: viewer.householdId },
    include: { owner: { select: { id: true, firstName: true } }, kid: { select: { firstName: true } } },
  });
  if (!t) return null;
  const item = schoolTaskItem({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, owner: t.owner }, viewer, now);
  const facts = [t.kid ? `For ${t.kid.firstName}` : "For everyone", t.owner ? `${t.owner.firstName} has it` : "Nobody has it yet", t.notes].filter((f): f is string => Boolean(f));
  return {
    type: "SCHOOL_TASK",
    item,
    facts,
    history: await historyOf(ref),
    edit: {
      title: t.title,
      kind: t.kind,
      dueDate: t.dueDate ? toISODate(t.dueDate) : "",
      amount: t.amountCents != null ? (t.amountCents / 100).toFixed(2) : "",
      kidPersonId: t.kidPersonId ?? "",
      ownerPersonId: t.ownerPersonId ?? "",
      notes: t.notes ?? "",
    },
  };
}
