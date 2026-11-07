"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { MoreMenu } from "@/components/more-menu";
import { StatusPill } from "@/components/status-pill";
import { ConfirmAction } from "@/components/submit";
import { iconBtn, menuItem } from "@/components/styles";
import type { WorkItem } from "@/lib/work-items/types";

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

export function AssignmentRow({
  item,
  className,
  dueText,
  overdue,
  editHref,
  removeQuestion,
  canRemove,
  onStatus,
  onRemove,
}: {
  item: WorkItem<AssignmentStatus>;
  className: string;
  dueText: string;
  overdue: boolean;
  /** Grown-ups' full edit page; absent for a kid. */
  editHref?: string;
  removeQuestion: string;
  canRemove: boolean;
  onStatus: (id: string, to: AssignmentStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { status, pending, failed, setFailed, start, pick } = useStatus(item, onStatus);
  const [confirming, setConfirming] = useState(false);
  // Cancel hands focus back to the ⋯ the question came from.
  const more = useRef<HTMLButtonElement>(null);
  const look = item.looks[status]!;
  const options = item.options[status] ?? [];
  const canTick = status !== "DONE" && options.some((o) => o.value === "DONE");
  // One change at a time: the menu waits for the last save.

  return (
    <RowShell>
      {canTick ? (
        <TickBox label={`Mark ${item.title} turned in`} disabled={pending} onTick={() => pick("DONE")} />
      ) : (
        <span aria-hidden className="size-11 shrink-0 sm:size-9" />
      )}
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm text-foreground">
          <span className="text-xs font-bold text-muted-foreground">{className}</span> {item.title}
        </p>
        <p className={`text-xs ${overdue && status === "TODO" ? "font-bold text-destructive" : "text-muted-foreground"}`}>{dueText}</p>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <StatusPill look={look} options={pending ? [] : options} title={item.title} onPick={pick} />
        {(editHref || canRemove) && (
          <MoreMenu label={`More for ${item.title}`} triggerRef={more}>
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

type TaskStatus = "OPEN" | "DONE";

export function SchoolTaskRow({
  item,
  details,
  meta,
  late,
  removeQuestion,
  onStatus,
  onRemove,
}: {
  item: WorkItem<TaskStatus>;
  /** The kind and amount, before and after the title. */
  details: { kind: string; amount: string | null };
  meta: string;
  late: boolean;
  removeQuestion: string;
  onStatus: (id: string, to: TaskStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { status, pending, failed, setFailed, start, pick } = useStatus(item, onStatus);
  const [confirming, setConfirming] = useState(false);
  // Cancel hands focus back to the ⋯ the question came from.
  const more = useRef<HTMLButtonElement>(null);
  const look = item.looks[status]!;

  return (
    <RowShell>
      {status === "OPEN" ? (
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
        <StatusPill look={look} options={pending ? [] : item.options[status]} title={item.title} onPick={pick} />
        <MoreMenu label={`More for ${item.title}`} triggerRef={more}>
          <button type="button" className={`${menuItem} text-destructive`} onClick={() => setConfirming(true)}>
            Remove
          </button>
        </MoreMenu>
      </div>
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
