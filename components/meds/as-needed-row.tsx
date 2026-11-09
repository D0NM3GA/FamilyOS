"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary } from "@/components/styles";
import type { AsNeededView } from "@/lib/meds/as-needed-queries";

type DoseState = { error?: string; ok?: string };

/**
 * Phase 65a: one as-needed medicine: when it was last taken, whether one may be taken now, and a
 * button to log a dose. The actions are passed in (Meds and Home both use it). The server checks
 * the gap and the daily maximum again, so a page left open can't get past them.
 */
export function AsNeededRow({
  med,
  viewerId,
  viewerIsAdult,
  showPerson = true,
  take,
  undo,
}: {
  med: AsNeededView;
  viewerId: string;
  viewerIsAdult: boolean;
  showPerson?: boolean;
  take: (definitionId: string) => Promise<DoseState>;
  undo: (instanceId: string) => Promise<void>;
}) {
  const [state, run] = useActionState(
    () => take(med.definitionId),
    {} as DoseState,
  );
  const [undoing, startUndo] = useTransition();
  // What the last Undo said, and which Take answer it replaced: "Logged" stays up otherwise,
  // saying the opposite of what just happened.
  const [undone, setUndone] = useState<{ after: DoseState; text: string; bad?: boolean } | null>(null);
  const message = undone && undone.after === state ? undone : state.error ? { text: state.error, bad: true } : state.ok ? { text: state.ok } : null;
  const undoLast = (id: string) =>
    startUndo(async () => {
      try {
        await undo(id);
        setUndone({ after: state, text: "Took the last dose back." });
      } catch {
        setUndone({ after: state, text: "Couldn't undo that. Check your connection and try again.", bad: true });
      }
    });
  const mayTake = viewerIsAdult || med.person?.id === viewerId;
  const mayUndo = med.last && (viewerIsAdult || med.last.byId === viewerId);
  return (
    <li className="ui-card rounded-2xl border-2 border-ink bg-card p-3 dark:border-white/20">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words">
            {med.title}
            {showPerson && med.person && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {med.person.firstName}
              </span>
            )}
            <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-input">
              as needed
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            {[med.notes, med.dosesLeft].filter(Boolean).join(" · ")}
          </p>
          <p className="text-sm font-semibold">{med.status}</p>
        </div>
        {mayTake && (
          <form action={run} className="shrink-0">
            <SubmitButton
              className={med.canTakeNow ? btnPrimary : btn}
              pendingText="Logging…"
              disabled={!med.canTakeNow}
            >
              Take a dose<span className="sr-only"> of {med.title}</span>
            </SubmitButton>
          </form>
        )}
      </div>
      {message?.bad && (
        <p role="alert" className="mt-1 text-sm font-semibold text-tomato">
          {message.text}
        </p>
      )}
      {message && !message.bad && (
        <p role="status" className="mt-1 text-sm font-semibold">
          {message.text}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        {(viewerIsAdult || med.person?.id === viewerId) && (
          <Link
            href={`/meds/${med.definitionId}/history`}
            className="inline-flex min-h-11 items-center text-xs font-bold text-muted-foreground underline underline-offset-2"
          >
            History<span className="sr-only"> of {med.title}</span>
          </Link>
        )}
        {mayUndo && med.last && (
          <button
            type="button"
            disabled={undoing}
            onClick={() => undoLast(med.last!.id)}
            className="min-h-11 text-xs font-bold text-muted-foreground underline underline-offset-2"
          >
            {undoing ? "Undoing…" : "Undo the last dose"}
              <span className="sr-only"> of {med.title}</span>
          </button>
        )}
      </div>
    </li>
  );
}
