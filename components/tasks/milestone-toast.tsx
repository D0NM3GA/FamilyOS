"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { btn } from "@/components/styles";

const MilestoneContext = createContext<((milestone: number) => void) | null>(null);

/** What a finished card hands the board so its Undo outlives the card. */
/** `verb` finishes "✓ {title} …": "done" unless said ("marked missed", "moved to tomorrow"). */
export type UndoReport = { title: string; verb?: string; undo: () => Promise<void> };
const UndoContext = createContext<((report: UndoReport) => void) | null>(null);

/** How long the Undo bar stays: long enough to notice and reach it. */
export const UNDO_MS = 10_000;

/**
 * Lets a TaskInstanceCard report a milestone to an ancestor that outlives it — needed
 * because on the Overdue/Upcoming boards (disappearsOnComplete), the card that just
 * crossed the milestone is exactly the card about to be removed from the list: the
 * server's PENDING-only query drops it on the same revalidation that resolves
 * onComplete's promise, often before the card's own milestone state ever paints. A
 * milestone held only in the card's own state can vanish silently; this context lives one
 * level up, in a wrapper that isn't tied to any one instance, so it survives.
 */
export function useReportMilestone(): (milestone: number) => void {
  return useContext(MilestoneContext) ?? (() => {});
}

/**
 * Same reason, for Undo: a card done on a board that drops it (Overdue, Upcoming) or folds it away
 * (Home's "✓ done") takes its own Undo button with it the moment the save lands. The board shows
 * an Undo bar for a few seconds instead. Null outside a board, so a card there keeps its own only.
 */
export function useReportUndo(): ((report: UndoReport) => void) | null {
  return useContext(UndoContext);
}

/** Wrap a board's list of TaskInstanceCards in this to give them somewhere to report a
 * milestone (and an Undo) that survives their own removal from the list. Renders both. */
export function MilestoneToastBoard({ children }: { children: ReactNode }) {
  const [milestone, setMilestone] = useState<number | null>(null);
  const [undo, setUndo] = useState<(UndoReport & { at: number }) | null>(null);
  const [undoState, setUndoState] = useState<"idle" | "working" | "failed">("idle");
  // Held open while the pointer or keyboard focus is on it, so reaching for Undo never races the timer.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (milestone == null) return;
    const timer = setTimeout(() => setMilestone(null), 3000);
    return () => clearTimeout(timer);
  }, [milestone]);

  useEffect(() => {
    if (!undo || undoState === "working" || held) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo, undoState, held]);

  const report = useCallback((r: UndoReport) => {
    setUndoState("idle");
    setUndo({ ...r, at: Date.now() });
  }, []);

  async function runUndo() {
    if (!undo) return;
    setUndoState("working");
    try {
      await undo.undo();
      setUndo(null);
      setUndoState("idle");
      setHeld(false);
    } catch {
      setUndoState("failed");
    }
  }

  return (
    <MilestoneContext.Provider value={setMilestone}>
      <UndoContext.Provider value={report}>
        {children}
        {milestone != null && (
          <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center motion-reduce:duration-0">
            <div className="animate-in zoom-in slide-in-from-top-4 rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-white shadow-lg duration-300">
              {milestone}th chore!
            </div>
          </div>
        )}
        {undo && (
          // Above the phone's bottom bar; the board's own content stays tappable around it.
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 sm:bottom-6">
            <div
              key={undo.at}
              role="status"
              onPointerEnter={() => setHeld(true)}
              onPointerLeave={() => setHeld(false)}
              onFocus={() => setHeld(true)}
              onBlur={() => setHeld(false)}
              className="ui-card pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl bg-card py-2 pl-4 pr-2 text-sm text-foreground shadow-lg ring-1 ring-border animate-in fade-in slide-in-from-bottom-4 duration-300"
            >
              <span className="min-w-0 truncate">
                {undoState === "failed" ? "Couldn't undo that. Try again." : <>✓ {undo.title} {undo.verb ?? "done"}</>}
              </span>
              <button type="button" onClick={runUndo} disabled={undoState === "working"} className={`${btn} shrink-0`}>
                {undoState === "working" ? "Undoing…" : "Undo"}
              </button>
            </div>
          </div>
        )}
      </UndoContext.Provider>
    </MilestoneContext.Provider>
  );
}
