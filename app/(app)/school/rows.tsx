"use client";

import Link from "next/link";
import { ClipboardCheck, Hammer, ListChecks, type LucideIcon } from "lucide-react";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { MoreMenu } from "@/components/more-menu";
import { StatusPill } from "@/components/status-pill";
import { ConfirmAction } from "@/components/submit";
import { btn, iconBtn, menuItem } from "@/components/styles";
import type { WorkItem } from "@/lib/work-items/types";
import { ASSIGNMENT_KIND_LABEL, type AssignmentKindValue } from "@/lib/school/form";
import { Pencil } from "lucide-react";
import { SelectBox, useSelection } from "@/components/selection";
import { AssignmentDetailsForm, GradeForm, TaskForm } from "./forms";
import type { SchoolFormState } from "./actions";

type FormAction = (prev: SchoolFormState, fd: FormData) => Promise<SchoolFormState>;

/** Phase 59.2a: a grown-up's Approve / Put back for a kid's own change. */
export function KidChange({ who, title, onApprove, onPutBack }: { who: string; title: string; onApprove: () => Promise<void>; onPutBack: () => Promise<void> }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setFailed(false);
      try {
        await fn();
      } catch (err) {
        console.error("[school-row] review failed", err);
        setFailed(true);
      }
    });
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <span className="mr-auto">Changed by {who}</span>
      <button type="button" disabled={pending} onClick={() => run(onApprove)} aria-label={`Approve ${who}'s change to ${title}`} className={btn}>
        Approve
      </button>
      {/* It overwrites what they typed, so it asks first, in place. */}
      <ConfirmAction
        question={`Put back ${title} as it was before ${who} changed it?`}
        yes="Put back"
        pending={pending}
        onConfirm={() => run(onPutBack)}
        aria-label={`Put back ${who}'s change to ${title}`}
        className={btn}
      >
        Put back
      </ConfirmAction>
      {failed && <span role="alert" className="basis-full text-destructive">Couldn&apos;t save that. Refresh the page and try again.</span>}
    </div>
  );
}

/**
 * Phase 59.1a: a row on School with its status pill. The pill and the tick box change the status
 * at once and put it back if the save fails; the server rules (lib/school/permissions.ts) decide
 * what's offered and check it again. Remove lives in the ⋯ menu and asks first, in the row.
 */
function useStatus<S extends string>(item: WorkItem<S>, onStatus: (id: string, to: S) => Promise<void>) {
  const [status, setStatus] = useOptimistic(item.status);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<false | "save" | "remove">(false);
  const pick = (to: S) => {
    setFailed(false);
    start(async () => {
      setStatus(to);
      try {
        await onStatus(item.id, to);
      } catch (err) {
        console.error("[school-row] status change failed", err);
        setFailed("save");
      }
    });
  };
  return { status, pending, failed, setFailed, start, pick };
}

/** A done box: small to look at, a whole thumb wide to tap. */
function TickBox({ label, disabled, onTick }: { label: string; disabled: boolean; onTick: () => void }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onTick} className={`group ${iconBtn}`}>
      <span aria-hidden className="size-5 rounded-md border-2 border-input transition group-hover:border-foreground" />
    </button>
  );
}

function Failed({ what }: { what: "save" | "remove" }) {
  return (
    <p role="alert" className="basis-full text-xs font-bold text-destructive">
      Couldn&apos;t {what} that. Refresh the page and try again.
    </p>
  );
}

function RowShell({ children }: { children: ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">{children}</li>;
}

type AssignmentStatus = "TODO" | "DONE" | "MISSING";
type AssignmentKind = AssignmentKindValue;

/** Phase 59.1b: tests, quizzes and projects say so; homework, the usual, says nothing. */
const KIND_ICON: Record<Exclude<AssignmentKind, "HOMEWORK">, LucideIcon> = { TEST: ClipboardCheck, QUIZ: ListChecks, PROJECT: Hammer };

function KindTag({ kind }: { kind: AssignmentKind }) {
  if (kind === "HOMEWORK") return null;
  const Icon = KIND_ICON[kind];
  const label = ASSIGNMENT_KIND_LABEL[kind];
  return (
    <span className="mr-1 inline-flex items-center gap-0.5 rounded-md bg-sky-100 px-1.5 text-xs font-bold text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
      <Icon size={12} aria-hidden />
      {label}
    </span>
  );
}

export function AssignmentRow({
  item,
  kind,
  className,
  dueText,
  overdue,
  editHref,
  detailsHref,
  removeQuestion,
  canRemove,
  onStatus,
  onRemove,
  details,
  grade,
  kidChange,
  selectable = false,
}: {
  item: WorkItem<AssignmentStatus>;
  kind: AssignmentKind;
  className: string;
  dueText: string;
  overdue: boolean;
  /** Grown-ups' full edit page; absent for a kid. */
  editHref?: string;
  /** Phase 59.4a: the side panel, with its history. */
  detailsHref?: string;
  removeQuestion: string;
  canRemove: boolean;
  onStatus: (id: string, to: AssignmentStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Phase 59.2a: the quick edit, when the viewer may change the details (a kid: their own). */
  details?: { action: FormAction; defaults: { title: string; className: string; kind: AssignmentKind; dueDate: string } };
  /** Phase 59.2a: grown-ups' "Grade it". */
  grade?: { action: FormAction; defaults: { score: string; maxScore: string } };
  /** Phase 59.2a: a kid's change waiting for a grown-up. */
  kidChange?: { who: string; onApprove: () => Promise<void>; onPutBack: () => Promise<void> };
  /** Phase 59.3: a tick box while the list is selecting. */
  selectable?: boolean;
}) {
  const { status, pending, failed, setFailed, start, pick } = useStatus(item, onStatus);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<null | "details" | "grade">(null);
  const words = useRef<HTMLButtonElement>(null);
  // Closing an edit hands focus back to what opened it.
  const closeEdit = () => {
    const was = editing;
    setEditing(null);
    requestAnimationFrame(() => (was === "details" ? words.current : more.current)?.focus());
  };
  // Cancel hands focus back to the ⋯ the question came from.
  const more = useRef<HTMLButtonElement>(null);
  const look = item.looks[status]!;
  const options = item.options[status] ?? [];
  // While the list is selecting, the row's own buttons step aside so a stray tap can't change it.
  const selection = useSelection();
  const picking = selectable && Boolean(selection?.active);
  const canTick = !picking && status !== "DONE" && options.some((o) => o.value === "DONE");
  // One change at a time: the menu waits for the last save.

  return (
    <RowShell>
      {selectable && <SelectBox id={item.id} label={item.title} />}
      {canTick ? (
        <TickBox label={`Mark ${item.title} turned in`} disabled={pending} onTick={() => pick("DONE")} />
      ) : (
        <span aria-hidden className="size-11 shrink-0 sm:size-9" />
      )}
      {details ? (
        // Tapping the words opens the quick edit, where the viewer may change them.
        <button
          ref={words}
          type="button"
          aria-expanded={editing === "details"}
          aria-label={`Change ${item.title}: ${className}${kind === "HOMEWORK" ? "" : `, ${ASSIGNMENT_KIND_LABEL[kind]}`}, ${dueText}`}
          onClick={() => setEditing(editing === "details" ? null : "details")}
          className="min-h-11 min-w-0 flex-1 basis-40 rounded-lg px-1 text-left hover:bg-muted"
        >
          <AssignmentWords className={className} kind={kind} title={item.title} dueText={dueText} late={overdue && status === "TODO"} editable />
        </button>
      ) : (
        <div className="min-w-0 flex-1 basis-40">
          <AssignmentWords className={className} kind={kind} title={item.title} dueText={dueText} late={overdue && status === "TODO"} />
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        <StatusPill look={look} options={picking ? [] : options} busy={pending} title={item.title} onPick={pick} />
        {!picking && (editHref || canRemove || grade || detailsHref) && (
          <MoreMenu label={`More for ${item.title}`} triggerRef={more}>
            {detailsHref && (
              <Link href={detailsHref} scroll={false} className={menuItem}>
                Details & history
              </Link>
            )}
            {grade && (
              <button type="button" className={menuItem} onClick={() => setEditing("grade")}>
                Grade it
              </button>
            )}
            {editHref && (
              <Link href={editHref} className={menuItem}>
                Edit
              </Link>
            )}
            {canRemove && (
              <button type="button" className={`${menuItem} text-destructive`} onClick={() => setConfirming(true)}>
                Remove
              </button>
            )}
          </MoreMenu>
        )}
      </div>
      {kidChange && (
        <KidChange who={kidChange.who} title={item.title} onApprove={kidChange.onApprove} onPutBack={kidChange.onPutBack} />
      )}
      {editing === "details" && details && <AssignmentDetailsForm action={details.action} defaults={details.defaults} onClose={closeEdit} />}
      {editing === "grade" && grade && <GradeForm action={grade.action} defaults={grade.defaults} onClose={closeEdit} />}
      {confirming && (
        <ConfirmAction
          initiallyAsking
          onCancel={() => {
            setConfirming(false);
            more.current?.focus();
          }}
          question={removeQuestion}
          yes="Remove"
          pending={pending}
          onConfirm={() =>
            start(async () => {
              try {
                await onRemove(item.id);
              } catch (err) {
                console.error("[school-row] remove failed", err);
                setFailed("remove");
                setConfirming(false);
              }
            })
          }
        >
          Remove
        </ConfirmAction>
      )}
      {failed && <Failed what={failed} />}
    </RowShell>
  );
}


function AssignmentWords({ className, kind, title, dueText, late, editable = false }: { className: string; kind: AssignmentKind; title: string; dueText: string; late: boolean; editable?: boolean }) {
  return (
    <>
      <span className="block text-sm text-foreground">
        <span className="text-xs font-bold text-muted-foreground">{className}</span> <KindTag kind={kind} />
        {/* A dotted line and a pencil say it can be changed, without needing a hover. */}
        <span className={editable ? "underline decoration-dotted decoration-muted-foreground underline-offset-4" : undefined}>{title}</span>
        {editable && <Pencil size={12} aria-hidden className="ml-1 inline text-muted-foreground" />}
      </span>
      <span className={`block text-xs ${late ? "font-bold text-destructive" : "text-muted-foreground"}`}>{dueText}</span>
    </>
  );
}

type TaskStatus = "OPEN" | "DONE";

export function SchoolTaskRow({
  item,
  details,
  meta,
  late,
  detailsHref,
  removeQuestion,
  onStatus,
  onRemove,
  edit,
  onClaim,
  selectable = false,
}: {
  item: WorkItem<TaskStatus>;
  /** The kind and amount, before and after the title. */
  details: { kind: string; amount: string | null };
  meta: string;
  late: boolean;
  /** Phase 59.4a: the side panel, with its history. */
  detailsHref?: string;
  removeQuestion: string;
  onStatus: (id: string, to: TaskStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Phase 59.2a: the full edit, opened in the row. */
  edit: { action: FormAction; defaults: Parameters<typeof TaskForm>[0]["defaults"]; kids: { id: string; name: string }[]; adults: { id: string; name: string }[] };
  /** Phase 59.2a: "I've got it", when someone else (or nobody) has it. */
  onClaim?: (id: string) => Promise<void>;
  /** Phase 59.3: a tick box while the list is selecting. */
  selectable?: boolean;
}) {
  const { status, pending, failed, setFailed, start, pick } = useStatus(item, onStatus);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const selection = useSelection();
  const picking = selectable && Boolean(selection?.active);
  const claim = () =>
    start(async () => {
      setFailed(false);
      try {
        await onClaim!(item.id);
      } catch (err) {
        console.error("[school-row] claim failed", err);
        setFailed("save");
      }
    });
  // Cancel hands focus back to the ⋯ the question came from.
  const more = useRef<HTMLButtonElement>(null);
  const look = item.looks[status]!;

  return (
    <RowShell>
      {selectable && status === "OPEN" && <SelectBox id={item.id} label={item.title} />}
      {status === "OPEN" && !picking ? (
        <TickBox label={`Mark ${item.title} done`} disabled={pending} onTick={() => pick("DONE")} />
      ) : (
        <span aria-hidden className="size-11 shrink-0 sm:size-9" />
      )}
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm text-foreground">
          <span className="text-xs text-muted-foreground">{details.kind}</span> {item.title}
          {details.amount && <span className="text-muted-foreground"> · {details.amount}</span>}
        </p>
        <p className={`text-xs ${late && status === "OPEN" ? "font-bold text-destructive" : "text-muted-foreground"}`}>{meta}</p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <StatusPill look={look} options={picking ? [] : item.options[status]} busy={pending} title={item.title} onPick={pick} />
        {!picking && (
        <MoreMenu label={`More for ${item.title}`} triggerRef={more}>
          {detailsHref && (
            <Link href={detailsHref} scroll={false} className={menuItem}>
              Details & history
            </Link>
          )}
          <button type="button" className={menuItem} onClick={() => setEditing(true)}>
            Edit
          </button>
          {onClaim && (
            <button type="button" className={menuItem} onClick={claim}>
              I&apos;ve got it
            </button>
          )}
          <button type="button" className={`${menuItem} text-destructive`} onClick={() => setConfirming(true)}>
            Remove
          </button>
        </MoreMenu>
        )}
      </div>
      {editing && (
        <div className="basis-full">
          <TaskForm action={edit.action} kids={edit.kids} adults={edit.adults} defaults={edit.defaults} onClose={() => setEditing(false)} />
        </div>
      )}
      {confirming && (
        <ConfirmAction
          initiallyAsking
          onCancel={() => {
            setConfirming(false);
            more.current?.focus();
          }}
          question={removeQuestion}
          yes="Remove"
          pending={pending}
          onConfirm={() =>
            start(async () => {
              try {
                await onRemove(item.id);
              } catch (err) {
                console.error("[school-row] remove failed", err);
                setFailed("remove");
                setConfirming(false);
              }
            })
          }
        >
          Remove
        </ConfirmAction>
      )}
      {failed && <Failed what={failed} />}
    </RowShell>
  );
}
