"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Home as HomeIcon, Mail, MessageSquare, Phone, StickyNote } from "lucide-react";
import { btn, btnDanger, btnPrimary, field } from "@/components/styles";
import { deleteInteraction, updateInteraction, type FormState } from "./actions";

export const INTERACTION_TYPES = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "TEXT", label: "Text" },
  { value: "EMAIL", label: "Email" },
  { value: "VISIT", label: "Visit" },
] as const;

const TYPE_ICON = { CALL: Phone, TEXT: MessageSquare, EMAIL: Mail, VISIT: HomeIcon, NOTE: StickyNote } as const;

export type InteractionRow = {
  id: string;
  type: keyof typeof TYPE_ICON;
  note: string | null;
  /** Precomputed on the server ("Oct 8, 3:04 PM"), so it can't differ after hydration. */
  when: string;
  /** The day it happened, "YYYY-MM-DD", for the edit form. */
  day: string;
  loggedBy: string | null;
  canEdit: boolean;
  /** Hidden from kids (only grown-ups ever get these rows). */
  adultsOnly: boolean;
};

/** Logged calls, texts and notes, newest first; whoever logged one (or a grown-up) can fix or remove it. */
export function InteractionList({
  personId,
  interactions,
  today,
  canHide,
}: {
  personId: string;
  interactions: InteractionRow[];
  today: string;
  canHide: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul className="space-y-3">
      {interactions.map((log) => {
        if (editing === log.id) {
          return (
            <li key={log.id}>
              <EditInteraction personId={personId} log={log} today={today} canHide={canHide} onDone={() => setEditing(null)} />
            </li>
          );
        }
        const Icon = TYPE_ICON[log.type];
        return (
          <li key={log.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-foreground">{log.note || log.type.charAt(0) + log.type.slice(1).toLowerCase()}</p>
              <p className="text-xs text-muted-foreground">
                {log.when}
                {log.loggedBy ? ` · logged by ${log.loggedBy}` : ""}
                {log.adultsOnly ? " · 🔒 grown-ups only" : ""}
              </p>
            </div>
            {log.canEdit && (
              <button
                type="button"
                onClick={() => setEditing(log.id)}
                aria-label={`Edit this ${log.type.toLowerCase()}`}
                className="min-h-11 shrink-0 self-start rounded-lg px-2 text-xs font-bold text-muted-foreground underline hover:text-foreground sm:min-h-0"
              >
                Edit
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EditInteraction({
  personId,
  log,
  today,
  canHide,
  onDone,
}: {
  personId: string;
  log: InteractionRow;
  today: string;
  canHide: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateInteraction.bind(null, personId, log.id), {});
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  return (
    <form action={formAction} className="space-y-2 rounded-md bg-muted p-3">
      <div className="flex flex-wrap gap-2">
        <select name="type" aria-label="Kind of contact" defaultValue={log.type} className={field}>
          {INTERACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input name="when" type="date" max={today} defaultValue={log.day} aria-label="When" className={field} />
      </div>
      <input name="note" defaultValue={log.note ?? ""} placeholder="What happened? (optional)" aria-label="What happened? (optional)" className={`${field} w-full`} />
      {canHide && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground sm:min-h-9">
          <input type="checkbox" name="adultsOnly" defaultChecked={log.adultsOnly} className="size-4" />
          🔒 Grown-ups only
        </label>
      )}
      {(state.error || deleteError) && <p role="alert" className="text-xs text-destructive">{state.error || deleteError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={btn}>
          Cancel
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={() => {
            if (!window.confirm("Delete this from the log?")) return;
            setDeleteError(null);
            startDelete(async () => {
              try {
                await deleteInteraction(personId, log.id);
              } catch {
                setDeleteError("Couldn't delete that. Someone may have changed it already; reload to check.");
              }
            });
          }}
          className={`${btnDanger} ml-auto`}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </form>
  );
}
