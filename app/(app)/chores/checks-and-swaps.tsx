import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary, sectionTitle } from "@/components/styles";
import type { waitingForCheck } from "@/lib/chores/checks";
import type { SwapView } from "@/lib/chores/swaps";
import { answerChoreSwap, cancelChoreSwap, checkInstance } from "./actions";

/**
 * Phase 70c: chores a kid ticked that wait for a grown-up's OK (grown-ups' board). OK pays the
 * stickers; Not yet puts it back to do.
 */
export function WaitingForCheck({ rows, notice, zone }: { rows: Awaited<ReturnType<typeof waitingForCheck>>; notice: "ok" | "again" | null; zone?: string }) {
  const said =
    notice === "ok" ? (
      <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-400">Checked and done. Any stickers are paid.</p>
    ) : notice === "again" ? (
      <p role="status" className="mt-2 text-sm text-muted-foreground">Sent back to do.</p>
    ) : null;
  // The last one checked still says so, even with nothing left to check.
  if (rows.length === 0) return said ? <div className="mt-6">{said}</div> : null;
  return (
    <section aria-labelledby="waiting-check" className="mt-6">
      <h2 id="waiting-check" className={sectionTitle}>
        Waiting for a check
      </h2>
      {said}
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-3 shadow-sm ring-1 ring-border">
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate text-sm font-medium text-foreground">{r.definition.title}</p>
              <p className="text-xs text-muted-foreground">
                {r.completedBy ? `${r.completedBy.firstName} says it's done` : "Ticked"} · {formatRelative(r.dueDate, zone)}
                {r.definition.points > 0 ? ` · +${r.definition.points} ⭐ on OK` : ""}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 gap-2">
              <form action={checkInstance.bind(null, r.id, false)}>
                <SubmitButton className={btn} aria-label={`Not yet: ${r.definition.title}`}>
                  Not yet
                </SubmitButton>
              </form>
              <form action={checkInstance.bind(null, r.id, true)}>
                <SubmitButton className={btnPrimary} aria-label={`OK: ${r.definition.title}`}>
                  OK
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const whenWord = (d: Date, zone?: string) => formatRelative(d, zone).toLowerCase();

/** Phase 70c: a kid's swaps: ones asked of them (Accept or No thanks), and their own (Cancel). */
export function KidSwaps({ incoming, outgoing, notice, zone }: { incoming: SwapView[]; outgoing: SwapView[]; notice: "asked" | "lapsed" | "gone" | "taken" | "declined" | null; zone?: string }) {
  return (
    <section aria-labelledby="swaps" className="mt-6 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="swaps" className={sectionTitle}>
          Swaps
        </h2>
        <Link href="/chores/swap" className={btn}>
          Ask to swap a chore
        </Link>
      </div>
      {notice === "asked" && <p role="status" className="text-sm text-green-700 dark:text-green-400">Asked. It&apos;s theirs once they say yes.</p>}
      {notice === "taken" && <p role="status" className="text-sm text-green-700 dark:text-green-400">Deal. It&apos;s yours now.</p>}
      {notice === "declined" && <p role="status" className="text-sm text-muted-foreground">Said no thanks. They&apos;ll keep it.</p>}
      {notice === "lapsed" && <p role="status" className="text-sm text-muted-foreground">That swap can&apos;t happen now: a chore was done, moved or given to someone else.</p>}
      {notice === "gone" && <p role="status" className="text-sm text-muted-foreground">That swap isn&apos;t waiting for you anymore.</p>}
      <ul className="space-y-2">
        {incoming.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-3 shadow-sm ring-1 ring-border">
            <p className="min-w-0 flex-1 basis-48 text-sm text-foreground">
              <span className="font-bold">{s.from}</span> asked you to take <span className="font-bold">{s.chore}</span> ({whenWord(s.day, zone)})
              {s.giveBack && (
                <>
                  , and will do your <span className="font-bold">{s.giveBack.chore}</span> ({whenWord(s.giveBack.day, zone)})
                </>
              )}
              .
            </p>
            <div className="ml-auto flex shrink-0 gap-2">
              <form action={answerChoreSwap.bind(null, s.id, false)}>
                <SubmitButton className={btn} aria-label={`No thanks: ${s.chore}`}>
                  No thanks
                </SubmitButton>
              </form>
              <form action={answerChoreSwap.bind(null, s.id, true)}>
                <SubmitButton className={btnPrimary} aria-label={`Deal: ${s.chore}`}>
                  Deal
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
        {outgoing.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-3 shadow-sm ring-1 ring-border">
            <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
              Waiting for <span className="font-bold text-foreground">{s.to}</span> to take {s.chore} ({whenWord(s.day, zone)})
              {s.giveBack ? `, for their ${s.giveBack.chore}` : ""}.
            </p>
            <form action={cancelChoreSwap.bind(null, s.id)} className="ml-auto">
              <SubmitButton className={btn} aria-label={`Cancel asking about ${s.chore}`}>
                Cancel
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Phase 70c: the kids' open swap requests, for grown-ups to see (read only). */
export function GrownUpSwaps({ swaps, zone }: { swaps: SwapView[]; zone?: string }) {
  if (swaps.length === 0) return null;
  return (
    <section aria-labelledby="swaps-asked" className="mt-6">
      <h2 id="swaps-asked" className={sectionTitle}>
        Swaps asked
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {swaps.map((s) => (
          <li key={s.id}>
            <span className="font-bold text-foreground">{s.from}</span> asked <span className="font-bold text-foreground">{s.to}</span> to take {s.chore} ({whenWord(s.day, zone)})
            {s.giveBack ? `, for their ${s.giveBack.chore}` : ""}.
          </li>
        ))}
      </ul>
    </section>
  );
}
