import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/roles";
import { canSeeStudent } from "@/lib/school/permissions";
import { isOverdue } from "@/lib/school/rules";
import { atMidnight } from "@/lib/tasks/schedule";
import { assignmentItem } from "./assignment";
import { schoolTaskItem } from "./school-task";
import type { WorkItem } from "./types";

/**
 * Phase 59.4b: a person's open schoolwork and the forms they're handling, for their record's "Open
 * items" (chores come from the chore board the page already reads). Homework only for whoever can
 * see it (grades are personal); forms for grown-ups. Through lib/work-items, the shared layer, so the
 * People pages don't reach into School themselves.
 */
type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };
export type OpenRow = { type: "ASSIGNMENT" | "SCHOOL_TASK"; item: WorkItem; label: string; due: Date | null; late: boolean };

export async function personOpenSchoolwork(viewer: Viewer, person: { id: string; firstName: string }, now: Date = new Date()): Promise<OpenRow[]> {
  const today = atMidnight(now);
  const [work, forms] = await Promise.all([
    canSeeStudent(viewer, person.id)
      ? prisma.schoolAssignment.findMany({
          where: { status: { in: ["TODO", "MISSING"] }, profile: { personId: person.id, person: { householdId: viewer.householdId } } },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        })
      : [],
    isAdult(viewer)
      ? prisma.schoolTask.findMany({
          where: { householdId: viewer.householdId, status: "OPEN", ownerPersonId: person.id },
          include: { owner: { select: { id: true, firstName: true } } },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        })
      : [],
  ]);
  return [
    ...work.map((a) => ({
      type: "ASSIGNMENT" as const,
      item: assignmentItem({ ...a, student: person }, viewer, now) as WorkItem,
      label: a.className,
      due: a.dueDate,
      late: isOverdue(a, now),
    })),
    ...forms.map((t) => ({
      type: "SCHOOL_TASK" as const,
      item: schoolTaskItem({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, owner: t.owner }, viewer, now) as WorkItem,
      label: "Form",
      due: t.dueDate,
      late: t.dueDate != null && t.dueDate < today,
    })),
  ];
}
