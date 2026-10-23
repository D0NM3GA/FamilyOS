import Link from "next/link";
import { AwayNote } from "@/components/away-time";
import { BunsonMoment } from "@/components/bunson-moment";
import { RewardWord } from "@/components/family-look";
import { TaskInstanceCard, type Instance } from "@/components/tasks/task-instance-card";
import { MilestoneToastBoard } from "@/components/tasks/milestone-toast";
import type { SchoolDueItem } from "@/lib/school/queries";

type Complete = (instanceId: string) => Promise<void | { milestone?: number | null }>;
type Undo = (instanceId: string) => Promise<void>;

/**
 * Phase 19.5 "Big buttons" Home: just the viewer's own things, larger. Presentational —
 * app/(app)/page.tsx fetches (only what this needs) and hands in each domain's actions, so
 * this file never imports a domain's actions itself. Phase 36: a turned-off app's section
 * isn't here (meds and school just arrive empty).
 */
export function BigHome({
  viewerId,
  viewerIsAdult,
  greeting,
  choresOn,
  stickers,
  goal,
  chores,
  meds,
  medTimes,
  overdueMedIds,
  school,
  onCompleteChore,
  onUndoChore,
  onCompleteMed,
  onUndoMed,
}: {
  viewerId: string;
  /** A grown-up can pick Big buttons too; the cards then allow what /chores would. */
  viewerIsAdult: boolean;
  greeting: string;
  /** Phase 36: false when the family turned Chores off (no "My chores" at all). */
  choresOn: boolean;
  /** Null when the family turned the Store off: no stickers card, nothing to spend on. */
  stickers: number | null;
  /** Phase 20: the reward this person is saving up for, if any. */
  goal?: { title: string; emoji: string | null; cost: number } | null;
  chores: Instance[];
  meds: Instance[];
  /** Precomputed server-side (see TaskInstanceCard's timeLabel doc), keyed by instance id. */
  medTimes: Record<string, string>;
  /** Missed doses from earlier days, which also show their date ("Yesterday · 8:00 AM"). */
  overdueMedIds: string[];
  school: SchoolDueItem[];
  onCompleteChore: Complete;
  onUndoChore: Undo;
  onCompleteMed: Complete;
  onUndoMed: Undo;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 sm:p-6">
      <h1 className="sr-only">Home</h1>
      <AwayNote />
      <BunsonMoment kind="chatty" text={greeting} />

      {stickers !== null && (
        <Link
          href="/points"
          className="flex items-center justify-between rounded-2xl border-2 border-ink bg-sun px-5 py-4 text-ink shadow-[4px_4px_0_var(--color-ink)] transition hover:-translate-y-0.5"
        >
          <span className="font-heading text-2xl font-extrabold">
            My <RewardWord />
          </span>
          <span className="flex items-center gap-2 font-heading text-3xl font-extrabold">
            <span aria-hidden>⭐</span>
            {stickers}
          </span>
        </Link>
      )}
      {stickers !== null && goal && (
        <p className="-mt-5 px-1 text-sm font-bold text-muted-foreground">
          Saving up for {goal.emoji ?? "🎁"} {goal.title}:{" "}
          {stickers >= goal.cost ? "you can get it now!" : `${goal.cost - Math.max(0, stickers)} more to go.`}
        </p>
      )}

      {choresOn && (
        <section>
          <h2 className="text-2xl font-extrabold">My chores</h2>
          {chores.length === 0 ? (
            <p className="mt-2 text-muted-foreground">
              Nothing on your list today.
              {stickers !== null && (
                <>
                  {" "}
                  <Link href="/points" className="font-bold text-foreground underline">
                    Peek in the <RewardWord form="store" />
                  </Link>{" "}
                  to plan what&apos;s next! 🛍️
                </>
              )}
            </p>
          ) : (
            <MilestoneToastBoard>
              <ul className="mt-3 space-y-3">
                {chores.map((i, idx) => (
                  <TaskInstanceCard
                    key={i.id}
                    instance={i}
                    viewerId={viewerId}
                    viewerIsAdult={viewerIsAdult}
                    onComplete={onCompleteChore}
                    onUndo={onUndoChore}
                    claimable
                    subtitle={i.assignedTo ? null : "Anyone can do this one. Grab it!"}
                    size="big"
                    completeLabel="Done!"
                    index={idx}
                  />
                ))}
              </ul>
            </MilestoneToastBoard>
          )}
        </section>
      )}

      {meds.length > 0 && (
        <section>
          <h2 className="text-2xl font-extrabold">My meds today</h2>
          <ul className="mt-3 space-y-3">
            {meds.map((i, idx) => (
              <TaskInstanceCard
                key={i.id}
                instance={i}
                viewerId={viewerId}
                viewerIsAdult={viewerIsAdult}
                onComplete={onCompleteMed}
                onUndo={onUndoMed}
                size="big"
                completeLabel="Taken"
                showDate={overdueMedIds.includes(i.id)}
                timeLabel={medTimes[i.id]}
                index={idx}
              />
            ))}
          </ul>
        </section>
      )}

      {school.length > 0 && (
        <section>
          <h2 className="text-2xl font-extrabold">School this week</h2>
          <ul className="mt-3 space-y-2">
            {school.map((s) => (
              <li key={`${s.kind}-${s.id}`}>
                <Link
                  href={s.href}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-lg font-bold ring-1 ring-border hover:bg-muted"
                >
                  <span className="truncate">
                    {s.title}
                    {s.who && <span className="ml-2 text-sm font-semibold text-muted-foreground">{s.who}</span>}
                  </span>
                  {s.overdue && <span className="shrink-0 text-sm font-extrabold text-destructive">Late</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
