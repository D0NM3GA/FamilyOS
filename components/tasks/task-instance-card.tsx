"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Undo2, CloudRain, Minus } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { useHouseholdZone } from "@/components/household-zone";
import { useReportMilestone } from "./milestone-toast";
import { useRewardWords } from "@/components/family-look";
import { rewardCount } from "@/lib/reward-words";

// Not imported from lib/people.ts's fullName: that module's top-level `import { prisma }`
// pulls the whole Postgres/pg dependency chain (Node built-ins like `tls`) into this
// client bundle the moment any export from it is used here, which Turbopack can't bundle
// for the browser. Same trivial logic, kept local instead.
function fullName(p: { firstName: string; lastName?: string | null }) {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

/**
 * Deliberately narrower than the full TaskInstance/Person Prisma rows — this file is a
 * client component, so every field on this type ships to the browser in the page's HTML.
 * Callers (app/(app)/chores/page.tsx, app/(app)/meds/page.tsx) must map down to exactly
 * this shape rather than passing a raw query result, which would leak assignee/completer
 * PII (pinHash, email, phone, notes) that used to never leave the server before this card
 * went client-side.
 */
export type Instance = {
  id: string;
  dueDate: Date;
  status: "PENDING" | "DONE" | "SKIPPED";
  completedAt: Date | null;
  definition: { title: string; points: number };
  assignedTo: { id: string; firstName: string; lastName: string | null } | null;
  completedBy: { id: string; firstName: string } | null;
};

const BURST_COLORS = [
  "bg-brand",
  "bg-amber-400",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-brand-hover",
  "bg-amber-300",
  "bg-emerald-400",
  "bg-sky-400",
];

/**
 * A one-shot celebratory particle burst on completion — pure CSS (the `burst-particle`
 * keyframe lives in globals.css), no animation library needed. `motion-reduce:hidden`
 * belt-and-suspenders with globals.css's broader prefers-reduced-motion block. Rendered as
 * a sibling of (not inside) the fading content wrapper below — nesting it inside would
 * mean the fade-out on a disappearing card dims the burst from its very first frame.
 */
function Burst() {
  return (
    <span className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 motion-reduce:hidden">
      {BURST_COLORS.map((color, i) => {
        const angle = (i / BURST_COLORS.length) * 2 * Math.PI + Math.PI / 10;
        const distance = 32 + (i % 3) * 8;
        const tx = Math.round(Math.cos(angle) * distance);
        const ty = Math.round(Math.sin(angle) * distance);
        const size = i % 2 === 0 ? "h-2 w-2" : "h-1.5 w-1.5";
        return (
          <span
            key={i}
            style={{ "--tx": `${tx}px`, "--ty": `${ty}px`, animationDelay: `${i * 15}ms` } as React.CSSProperties}
            className={`absolute left-0 top-0 ${size} rounded-full ${color} animate-[burst-particle_750ms_ease-out_forwards]`}
          />
        );
      })}
    </span>
  );
}

/**
 * Shared by every task-engine domain's board (Chores, Meds, ...) — `onComplete`/`onUndo`
 * are passed in as props (each domain's own server action) rather than imported directly,
 * so this component never silently calls the wrong domain's action just because it lives
 * in a shared location now.
 *
 * Only the overdue/upcoming boards drop a completed instance from view (their queries are
 * PENDING-only — see lib/tasks/queries.ts); today's board keeps DONE instances in place.
 * `disappearsOnComplete` tells the card whether to play an optimistic exit fade to bridge
 * the gap until the server round-trip actually removes it, versus just transitioning color
 * in place for a card that's staying put.
 */
export function TaskInstanceCard({
  instance,
  viewerId,
  viewerIsAdult,
  onComplete,
  onUndo,
  onReassign,
  reassignCandidates,
  onSkip,
  onUnskip,
  skipLabel = "Skip",
  claimable = false,
  weatherNote,
  showDate = true,
  timeLabel,
  subtitle,
  disappearsOnComplete = false,
  index = 0,
  size = "normal",
  completeLabel = "Complete",
}: {
  instance: Instance;
  viewerId: string;
  viewerIsAdult: boolean;
  /**
   * Chores' completeInstance returns `{ milestone }` (see lib/tasks/milestones.ts); Meds'
   * still returns plain `void`, which satisfies this widened type unchanged — a domain
   * that never returns a milestone just never triggers the extra celebration below.
   */
  onComplete: (instanceId: string) => Promise<void | { milestone?: number | null }>;
  onUndo: (instanceId: string) => Promise<void>;
  /** Adult-only "cheap swap" — reassign a still-PENDING instance to someone else. Omitted
   * entirely by Meds' board; only rendered here when both this AND reassignCandidates are
   * given, so a domain that doesn't pass them gets no UI for it, not a broken one. */
  onReassign?: (instanceId: string, newAssigneeId: string) => Promise<void>;
  reassignCandidates?: { id: string; firstName: string }[];
  /** Grown-ups' "Skip" ("Missed" once it's past due) and its undo (lib/tasks/skip.ts). */
  onSkip?: (instanceId: string) => Promise<void>;
  onUnskip?: (instanceId: string) => Promise<void>;
  /** "Missed" on the overdue board, "Skip" for one still to come. */
  skipLabel?: "Skip" | "Missed";
  /** Chores: anyone, kids included, can do an "Anyone" one (and earns its stickers). Never meds. */
  claimable?: boolean;
  /** A short precomputed flag string (e.g. "Rain Likely · 80%") — like `timeLabel`, always
   * computed server-side and passed as a plain string, never derived in here. */
  weatherNote?: string | null;
  showDate?: boolean;
  /**
   * The dueDate's time-of-day (e.g. "8:00 AM"), for multi-dose (meds) instances where the
   * exact time — not just the day — distinguishes one card from another. Must be
   * precomputed server-side (see lib/format.ts's formatTimeOfDay) and passed as a plain
   * string, never formatted in here: this is a client component, so formatting a Date's
   * time-of-day locally would run once on the server (Node's timezone) and again on
   * hydration (the browser's), risking a mismatch. Combined with `showDate`'s relative
   * label when both are given (e.g. "Yesterday · 8:00 AM"), shown alone otherwise.
   */
  timeLabel?: string | null;
  /** Optional line under the title — e.g. a medication's dosage/instructions. */
  subtitle?: string | null;
  disappearsOnComplete?: boolean;
  /** Staggers this card's entrance on page load — see docs/BUILD.md Design pass v2. */
  index?: number;
  /**
   * Phase 19.5 "Big buttons" view: larger text and a chunky sticker button, and the
   * assignee's name is dropped (it's always "my" list there).
   */
  size?: "normal" | "big";
  /** The complete button's label, e.g. "Done!" for chores or "Taken" for meds. */
  completeLabel?: string;
}) {
  const reward = useRewardWords();
  const big = size === "big";
  const zone = useHouseholdZone();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(instance.status);
  const [, startTransition] = useTransition();
  const [celebrating, setCelebrating] = useState(false);
  // Set only when onComplete's result actually reports one (Meds' plain-void action never
  // does) — a bigger, longer second wave layered on top of the always-instant 650ms burst
  // below, once the server round-trip confirms a milestone was actually crossed.
  const [milestoneHit, setMilestoneHit] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const reportMilestone = useReportMilestone();

  // Derived, not separate state: exiting is exactly "this board drops completed instances
  // AND we're (optimistically) done or skipped" — ties it to optimisticStatus so a failed action
  // reverting the status also reverts the fade, instead of leaving the card stuck invisible.
  const exiting = disappearsOnComplete && optimisticStatus !== "PENDING";

  const canComplete =
    optimisticStatus === "PENDING" &&
    (viewerIsAdult || instance.assignedTo?.id === viewerId || (claimable && !instance.assignedTo));
  const canUndo =
    optimisticStatus === "DONE" &&
    (viewerIsAdult || instance.completedBy?.id === viewerId);
  const canReassign = Boolean(onReassign && reassignCandidates?.length) && viewerIsAdult && optimisticStatus === "PENDING";
  const canSkip = Boolean(onSkip) && viewerIsAdult && optimisticStatus === "PENDING";
  const canUnskip = Boolean(onUnskip) && viewerIsAdult && optimisticStatus === "SKIPPED";

  function handleComplete() {
    setFailed(false);
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 650);
    startTransition(async () => {
      setOptimisticStatus("DONE");
      let result: Awaited<ReturnType<typeof onComplete>>;
      try {
        result = await onComplete(instance.id);
      } catch (err) {
        // A stale card (the dose or chore changed underneath it) shouldn't take the whole
        // page down to the error boundary: the optimistic DONE reverts, and the card says so
        // instead of having celebrated a save that didn't happen.
        console.error("[task-card] complete failed", err);
        setCelebrating(false);
        setFailed(true);
        return;
      }
      const milestone = result && typeof result === "object" ? result.milestone : null;
      if (milestone) {
        // Both fire: the in-place badge below covers the common case (a card that stays
        // mounted — Today, or any non-disappearing board); reportMilestone covers
        // disappearsOnComplete boards, where this card is often gone before its own state
        // ever paints — see components/tasks/milestone-toast.tsx.
        setMilestoneHit(milestone);
        reportMilestone(milestone);
        setCelebrating(true); // a second, longer wave on top of the click-time burst above
        setTimeout(() => {
          setCelebrating(false);
          setMilestoneHit(null);
        }, 3000);
      }
    });
  }

  function handleUndo() {
    setFailed(false);
    startTransition(async () => {
      setOptimisticStatus("PENDING");
      try {
        await (optimisticStatus === "SKIPPED" ? onUnskip!(instance.id) : onUndo(instance.id));
      } catch (err) {
        // Same as complete: a stale card reverts instead of taking the page down.
        console.error("[task-card] undo failed", err);
        setFailed(true);
      }
    });
  }

  function handleSkip() {
    setFailed(false);
    startTransition(async () => {
      setOptimisticStatus("SKIPPED");
      try {
        await onSkip!(instance.id);
      } catch (err) {
        console.error("[task-card] skip failed", err);
        setFailed(true);
      }
    });
  }

  function handleReassign(newAssigneeId: string) {
    if (!newAssigneeId || !onReassign) return;
    startTransition(() => onReassign(instance.id, newAssigneeId));
  }

  const dateLabel = [showDate ? formatRelative(instance.dueDate, zone) : null, timeLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className="relative animate-in fade-in slide-in-from-left-6 fill-mode-backwards duration-400"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      {celebrating && <Burst />}

      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 bg-card shadow-sm ring-1 ring-border transition-all duration-300 ${
          big ? "rounded-2xl p-4" : "rounded-lg p-3"
        } ${
          exiting ? "scale-95 opacity-0" : "scale-100 opacity-100"
        } ${celebrating ? "animate-[pop_500ms_ease-out]" : ""}`}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white transition-colors duration-300 ${
            big ? "size-11 text-base" : "size-8 text-xs"
          } ${
            optimisticStatus === "DONE" ? "bg-emerald-600" : optimisticStatus === "SKIPPED" ? "bg-stone-400 dark:bg-stone-600" : "bg-stone-700"
          }`}
        >
          {optimisticStatus === "DONE" ? (
            <Check size={14} className="animate-in zoom-in duration-300" />
          ) : optimisticStatus === "SKIPPED" ? (
            <Minus size={14} aria-label="Skipped" />
          ) : (
            instance.assignedTo?.firstName.slice(0, 1).toUpperCase() ?? "?"
          )}
        </span>

        {/* Wide enough for a real title: on a phone the buttons wrap under it instead of
            squeezing it to "Empty th…". */}
        <div className="min-w-0 flex-1 basis-40">
          <p className={`truncate text-foreground ${big ? "text-lg font-bold" : "text-sm font-medium"}`}>
            {instance.definition.title}
            {milestoneHit ? (
              <span className="ml-2 animate-in zoom-in rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-white duration-300">
                {milestoneHit}th chore!
              </span>
            ) : (
              instance.definition.points > 0 && (
                <span
                  title={rewardCount(instance.definition.points, reward)}
                  className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                >
                  +{instance.definition.points} ⭐
                </span>
              )
            )}
            {weatherNote && (
              <span
                title={weatherNote}
                className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
              >
                <CloudRain size={10} />
                {weatherNote}
              </span>
            )}
          </p>
          <p className={`truncate text-muted-foreground ${big ? "text-sm" : "text-xs"}`}>
            {big
              ? [dateLabel, subtitle].filter(Boolean).join(" · ")
              : `${instance.assignedTo ? fullName(instance.assignedTo) : claimable ? "Anyone: grab it!" : "Unassigned"}${dateLabel ? ` · ${dateLabel}` : ""}${subtitle ? ` · ${subtitle}` : ""}`}
            {!big && optimisticStatus === "DONE" && instance.completedBy
              ? ` · done by ${instance.completedBy.firstName}`
              : ""}
            {!big && optimisticStatus === "SKIPPED" ? ` · skipped${instance.completedBy ? ` by ${instance.completedBy.firstName}` : ""}` : ""}
          </p>
        </div>

        {failed && (
          <p role="alert" className="basis-full text-xs font-bold text-destructive">
            Couldn&apos;t save that. Check your connection and try again.
          </p>
        )}

        {(canReassign || canSkip || canComplete || canUndo || canUnskip) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canReassign && (
              <select
                defaultValue=""
                onChange={(e) => {
                  handleReassign(e.target.value);
                  e.target.value = "";
                }}
                aria-label="Reassign to"
                title="Reassign"
                className="min-h-11 shrink-0 rounded-xl border-2 border-input bg-card px-2 text-sm text-muted-foreground focus:border-ring focus:outline-none sm:min-h-9"
              >
                <option value="" disabled>
                  Reassign…
                </option>
                {reassignCandidates!
                  .filter((m) => m.id !== instance.assignedTo?.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName}
                    </option>
                  ))}
              </select>
            )}

            {canSkip && (
              <button
                type="button"
                onClick={handleSkip}
                title={`Nobody does this one: no ${reward.many}`}
                className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold text-muted-foreground ring-1 ring-input transition hover:bg-muted hover:text-foreground sm:min-h-9"
              >
                {skipLabel}
              </button>
            )}
            {canComplete && (
              <button
                type="button"
                onClick={handleComplete}
                className={
                  big
                    ? "min-h-14 shrink-0 rounded-2xl border-2 border-ink bg-lime px-5 text-base font-extrabold text-ink shadow-[3px_3px_0_var(--color-ink)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
                    : "min-h-11 shrink-0 rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:scale-105 hover:rotate-2 hover:bg-brand-hover hover:shadow-md active:translate-y-0 active:scale-100 active:rotate-0 sm:min-h-9"
                }
              >
                {completeLabel}
              </button>
            )}
            {(canUndo || canUnskip) && (
              <button
                type="button"
                onClick={handleUndo}
                title="Undo"
                aria-label="Undo"
                className={`inline-flex shrink-0 items-center justify-center rounded-xl text-muted-foreground ring-1 ring-border transition hover:bg-muted hover:text-foreground ${big ? "size-14" : "size-11 sm:size-9"}`}
              >
                <Undo2 size={big ? 20 : 16} />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
