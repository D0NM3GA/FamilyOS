"use client";

import { AssignmentDetailsForm, GradeForm, TaskForm } from "./school/forms";
import type { SchoolFormState } from "./school/actions";
import { useClosePanel } from "./item-panel-parts";

type FormAction = (prev: SchoolFormState, fd: FormData) => Promise<SchoolFormState>;

/** Phase 59.4a: the side panel's edits, reusing the rows' own forms. */
export function PanelAssignmentForms({
  closeHref,
  details,
  grade,
}: {
  closeHref: string;
  details: { action: FormAction; defaults: Parameters<typeof AssignmentDetailsForm>[0]["defaults"] } | null;
  grade: { action: FormAction; defaults: { score: string; maxScore: string } } | null;
}) {
  const close = useClosePanel(closeHref);
  return (
    <div className="space-y-3">
      {details && <AssignmentDetailsForm action={details.action} defaults={details.defaults} onClose={close} />}
      {grade && <GradeForm action={grade.action} defaults={grade.defaults} onClose={close} />}
    </div>
  );
}

export function PanelTaskForm({
  closeHref,
  action,
  defaults,
  kids,
  adults,
}: {
  closeHref: string;
  action: FormAction;
  defaults: NonNullable<Parameters<typeof TaskForm>[0]["defaults"]>;
  kids: { id: string; name: string }[];
  adults: { id: string; name: string }[];
}) {
  const close = useClosePanel(closeHref);
  return <TaskForm action={action} defaults={defaults} kids={kids} adults={adults} onClose={close} />;
}
