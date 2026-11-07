/**
 * Phase 59.1a: one status language for everything someone does — a chore, a piece of homework, a
 * school form. Each domain keeps its own table and stored statuses; an adapter (chore.ts,
 * assignment.ts, school-task.ts) turns a row and the viewer into a WorkItem the shared pieces
 * (StatusPill now; the list view and side panel in 59.4) can draw.
 *
 * Pure, no Prisma and no server imports (the role test comes from lib/roles.ts). Adapters run on
 * the server, and only the computed WorkItem crosses to the browser, so nothing here decides a
 * date in the browser's zone.
 */

export type WorkItemType = "CHORE" | "ASSIGNMENT" | "SCHOOL_TASK";

/** The shared vocabulary. Derived from each domain's stored status and due date, never stored. */
export type WorkStatus =
  | "DUE"
  | "DUE_TODAY"
  | "OVERDUE"
  | "DONE"
  | "TURNED_IN"
  | "GRADED"
  | "SKIPPED"
  | "MISSED"
  | "MISSING";

/** How the pill is colored. The classes live in components/status-pill.tsx. */
export type Tone = "neutral" | "soon" | "late" | "done" | "quiet";

export type PillLook = { status: WorkStatus; label: string; tone: Tone };

/** A status the viewer may move the item to: `value` is the domain's own stored status. */
export type StatusOption<S extends string> = { value: S; label: string };

export type WorkItem<S extends string = string> = {
  type: WorkItemType;
  id: string;
  title: string;
  who: { id: string; firstName: string } | null;
  due: Date | null;
  /** The domain's stored status right now. */
  status: S;
  /**
   * The pill for every status the item can be in from here, so a client can switch looks
   * optimistically without working out dates itself.
   */
  looks: Partial<Record<S, PillLook>>;
  /** What the viewer may pick, from each of those statuses. */
  options: Partial<Record<S, StatusOption<S>[]>>;
};

export type Viewer = { id: string; role: "ADMIN" | "ADULT" | "KID" | null };

/** The pill for something still to do, from its due date. `today` is a midnight. */
export function dueLook(due: Date | null, today: Date, overdue: boolean): PillLook {
  if (overdue) return { status: "OVERDUE", label: "Overdue", tone: "late" };
  if (due) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (due >= today && due < tomorrow) return { status: "DUE_TODAY", label: "Due today", tone: "soon" };
  }
  return { status: "DUE", label: "To do", tone: "neutral" };
}
