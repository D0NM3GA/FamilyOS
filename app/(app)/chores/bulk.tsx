"use client";

import { useRef, useState, useTransition } from "react";
import { BulkBar } from "@/components/selection";
import { MoreMenu } from "@/components/more-menu";
import { ConfirmAction } from "@/components/submit";
import { btn, menuItem } from "@/components/styles";
import { bulkMessage, type BulkResult } from "@/lib/work-items/bulk";

type Bulk = (input: { ids: string[]; action: "DONE" | "SKIP" | "REASSIGN" | "TOMORROW"; value?: string }) => Promise<BulkResult | { error: string }>;

/** Phase 59.3: Chores' bar while selecting. */
export function ChoresBulkBar({ bulk, people }: { bulk: Bulk; people: { id: string; firstName: string }[] }) {
  return (
    <BulkBar
      actions={[
        { key: "done", label: "Done", verb: "Done", run: (ids) => bulk({ ids, action: "DONE" }) },
        { key: "skip", label: "Skip", verb: "Skipped", run: (ids) => bulk({ ids, action: "SKIP" }) },
        { key: "tomorrow", label: "Move to tomorrow", verb: "Moved", run: (ids) => bulk({ ids, action: "TOMORROW" }) },
      ]}
      giveTo={{ people, run: (ids, personId) => bulk({ ids, action: "REASSIGN", value: personId }) }}
    />
  );
}

/**
 * Phase 59.3's two presets, for the person the board is filtered to: a sick day skips what they
 * have today (asking first, saying how many); a hand-off gives their next two days to someone else.
 * Both are the bulk action with the list worked out by the page.
 */
export function ChorePresets({
  bulk,
  person,
  sickDayIds,
  handOffIds,
  others,
}: {
  bulk: Bulk;
  person: string;
  sickDayIds: string[];
  handOffIds: string[];
  others: { id: string; firstName: string }[];
}) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // After a preset, focus goes to what it said (the question it came from is gone).
  const said = useRef<HTMLParagraphElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  if (sickDayIds.length === 0 && handOffIds.length === 0) return null;
  const go = (verb: string, run: () => ReturnType<Bulk>) =>
    start(async () => {
      try {
        const r = await run();
        setMessage("error" in r ? r.error : bulkMessage(r, verb));
      } catch (err) {
        console.error("[presets] failed", err);
        setMessage("Couldn't save that. Check your connection and try again.");
      } finally {
        setAsking(false);
        requestAnimationFrame(() => said.current?.focus());
      }
    });
  const n = sickDayIds.length;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <MoreMenu label={`Quick changes for ${person}`} face={<span className="px-1 text-sm font-bold">For {person}…</span>} triggerClassName={btn} triggerRef={menuButton}>
        {n > 0 && (
          <button type="button" className={menuItem} onClick={() => setAsking(true)}>
            Sick day (skip today&apos;s {n})
          </button>
        )}
        {handOffIds.length > 0 &&
          others.map((o) => (
            <button key={o.id} type="button" disabled={pending} className={menuItem} onClick={() => go("Gave", () => bulk({ ids: handOffIds, action: "REASSIGN", value: o.id }))}>
              Hand off to {o.firstName} (today and tomorrow)
            </button>
          ))}
      </MoreMenu>
      {asking && (
        <ConfirmAction
          initiallyAsking
          onCancel={() => {
            setAsking(false);
            menuButton.current?.focus();
          }}
          question={`Skip ${person}'s ${n} ${n === 1 ? "chore" : "chores"} today? Nobody gets stickers for them.`}
          yes="Skip them"
          pending={pending}
          onConfirm={() => go("Skipped", () => bulk({ ids: sickDayIds, action: "SKIP" }))}
        >
          Sick day
        </ConfirmAction>
      )}
      {message && (
        <p ref={said} tabIndex={-1} role="status" className="basis-full text-sm font-bold text-foreground outline-none">
          {message}
        </p>
      )}
    </div>
  );
}
