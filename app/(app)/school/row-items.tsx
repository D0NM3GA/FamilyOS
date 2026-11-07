import { formatFullDate, toISODate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { isOverdue } from "@/lib/school/rules";
import { canEditAssignmentDetails, canRemoveAssignment } from "@/lib/school/permissions";
import { assignmentItem } from "@/lib/work-items/assignment";
import { schoolTaskItem } from "@/lib/work-items/school-task";
import { isAdult } from "@/lib/authz";
import {
  approveKidChange,
  claimTask,
  deleteAssignment,
  deleteTask,
  gradeAssignment,
  putBackKidChange,
  setAssignmentDetails,
  setAssignmentStatus,
  setTaskStatus,
  updateTask,
} from "./actions";
import { AssignmentRow, SchoolTaskRow } from "./rows";

/**
 * Phase 59.4a: a homework row and a form row with everything they need, shared by one student's
 * page and the Everyone list, so both offer the same quick changes under the same rules.
 */

const KIND_LABEL = { FORM: "📝 Form", FEE: "💵 Fee", SUPPLIES: "✏️ Supplies", OTHER: "📌 To-do" } as const;

type Viewer = { id: string; householdId: string; role: "ADMIN" | "ADULT" | "KID" | null };
type Assignment = {
  id: string;
  title: string;
  className: string;
  kind: "HOMEWORK" | "TEST" | "QUIZ" | "PROJECT";
  dueDate: Date | null;
  status: "TODO" | "DONE" | "MISSING";
  score: number | null;
  maxScore: number | null;
  kidChangedAt: Date | null;
};

export function HomeworkRow({
  a,
  student,
  viewer,
  today,
  detailsHref,
  showStudent = false,
}: {
  a: Assignment;
  student: { id: string; firstName: string };
  viewer: Viewer;
  today: Date;
  /** The side panel for this one (its history). */
  detailsHref: string;
  /** On the Everyone list, the row says whose it is. */
  showStudent?: boolean;
}) {
  const adult = isAdult(viewer);
  const overdue = isOverdue(a, today);
  return (
    <AssignmentRow
      kind={a.kind}
      item={assignmentItem({ ...a, student }, viewer, today)}
      className={showStudent ? `${student.firstName} · ${a.className}` : a.className}
      dueText={a.dueDate ? `${overdue ? "Was due" : "Due"} ${formatFullDate(a.dueDate)}` : "No due date"}
      overdue={overdue}
      editHref={adult ? `/school/${student.id}/assignments/${a.id}` : undefined}
      detailsHref={detailsHref}
      canRemove={canRemoveAssignment(viewer, { studentId: student.id, status: a.status, score: a.score })}
      removeQuestion={`Remove "${a.title}"${a.score != null ? " and its grade" : ""}? This can't be undone.`}
      onStatus={setAssignmentStatus}
      onRemove={deleteAssignment}
      details={
        canEditAssignmentDetails(viewer, { studentId: student.id, status: a.status, score: a.score })
          ? { action: setAssignmentDetails.bind(null, a.id), defaults: { title: a.title, className: a.className, kind: a.kind, dueDate: a.dueDate ? toISODate(a.dueDate) : "" } }
          : undefined
      }
      grade={adult ? { action: gradeAssignment.bind(null, a.id), defaults: { score: a.score?.toString() ?? "", maxScore: a.maxScore?.toString() ?? "" } } : undefined}
      selectable={adult}
      kidChange={
        adult && a.kidChangedAt
          ? {
              who: student.firstName,
              onApprove: approveKidChange.bind(null, a.id, a.kidChangedAt.toISOString()),
              onPutBack: putBackKidChange.bind(null, a.id, a.kidChangedAt.toISOString()),
            }
          : undefined
      }
    />
  );
}

type Task = {
  id: string;
  title: string;
  kind: keyof typeof KIND_LABEL;
  dueDate: Date | null;
  status: "OPEN" | "DONE";
  amountCents: number | null;
  kidPersonId: string | null;
  ownerPersonId: string | null;
  notes: string | null;
  kid: { firstName: string } | null;
  owner: { id: string; firstName: string } | null;
};

export function FormRow({
  t,
  viewer,
  today,
  detailsHref,
  kids,
  adults,
}: {
  t: Task;
  viewer: Viewer;
  today: Date;
  detailsHref: string;
  kids: { id: string; name: string }[];
  adults: { id: string; name: string }[];
}) {
  const late = t.dueDate != null && t.dueDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return (
    <SchoolTaskRow
      item={schoolTaskItem({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, owner: t.owner }, viewer, today)}
      details={{ kind: KIND_LABEL[t.kind], amount: t.amountCents != null ? formatMoney(t.amountCents) : null }}
      meta={[t.dueDate ? `${late ? "Was due" : "Due"} ${formatFullDate(t.dueDate)}` : "No due date", t.kid ? t.kid.firstName : "everyone", t.owner ? `${t.owner.firstName} has it` : null]
        .filter(Boolean)
        .join(" · ")}
      late={late}
      detailsHref={detailsHref}
      removeQuestion={`Remove "${t.title}"? This can't be undone.`}
      onStatus={setTaskStatus}
      onRemove={deleteTask}
      edit={{
        action: updateTask.bind(null, t.id),
        defaults: {
          title: t.title,
          kind: t.kind,
          dueDate: t.dueDate ? toISODate(t.dueDate) : "",
          amount: t.amountCents != null ? (t.amountCents / 100).toFixed(2) : "",
          kidPersonId: t.kidPersonId ?? "",
          ownerPersonId: t.ownerPersonId ?? "",
          notes: t.notes ?? "",
        },
        kids,
        adults,
      }}
      onClaim={t.ownerPersonId === viewer.id ? undefined : claimTask}
      selectable
    />
  );
}
