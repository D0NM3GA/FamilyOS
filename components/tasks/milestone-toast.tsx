"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const MilestoneContext = createContext<((milestone: number) => void) | null>(null);

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

/** Wrap a board's list of TaskInstanceCards in this to give them somewhere to report a
 * milestone that survives their own removal from the list. Renders the toast itself. */
export function MilestoneToastBoard({ children }: { children: ReactNode }) {
  const [milestone, setMilestone] = useState<number | null>(null);

  useEffect(() => {
    if (milestone == null) return;
    const timer = setTimeout(() => setMilestone(null), 3000);
    return () => clearTimeout(timer);
  }, [milestone]);

  return (
    <MilestoneContext.Provider value={setMilestone}>
      {children}
      {milestone != null && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center motion-reduce:duration-0">
          <div className="animate-in zoom-in slide-in-from-top-4 rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-white shadow-lg duration-300">
            {milestone}th chore!
          </div>
        </div>
      )}
    </MilestoneContext.Provider>
  );
}
