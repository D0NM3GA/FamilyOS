"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { MoreMenu } from "@/components/more-menu";
import { btn, btnPrimary, menuItem } from "@/components/styles";
import { BULK_MAX, bulkMessage, type BulkResult } from "@/lib/work-items/bulk";
import { useReportMilestone } from "@/components/tasks/milestone-toast";

/**
 * Phase 59.3: pick several, act once. A board wraps its list in a SelectionProvider; "Select"
 * turns its rows' checkboxes on, and the BulkBar at the bottom runs one action over what's ticked.
 * The selection is the page's own state: it clears when the provider's key changes (a new person
 * or student) and after each action. Grown-ups only, never in Big buttons (the page decides).
 */

type Selection = {
  active: boolean;
  setActive: (on: boolean) => void;
  selected: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value: Selection = {
    active,
    setActive: (on) => {
      setActiveState(on);
      if (!on) setSelected(new Set());
    },
    selected,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < BULK_MAX) next.add(id);
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The board's selection, or null outside a SelectionProvider (a card that isn't on a board). */
export function useSelection(): Selection | null {
  return useContext(SelectionContext);
}

export function SelectToggle({ label = "Select" }: { label?: string }) {
  const s = useSelection();
  if (!s) return null;
  return (
    <button type="button" aria-pressed={s.active} onClick={() => s.setActive(!s.active)} className={btn}>
      {s.active ? "Cancel" : label}
    </button>
  );
}

/** A row's tick box while selecting; nothing otherwise. */
export function SelectBox({ id, label }: { id: string; label: string }) {
  const s = useSelection();
  if (!s?.active) return null;
  const checked = s.selected.has(id);
  return (
    <label className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center sm:size-9">
      <input type="checkbox" checked={checked} onChange={() => s.toggle(id)} aria-label={`Select ${label}`} className="size-5 accent-brand" />
    </label>
  );
}

export type BulkAction = { key: string; label: string; verb: string; run: (ids: string[]) => Promise<BulkResult | { error: string }> };

/**
 * The sticky bar while selecting: how many, the actions, and Cancel. `giveTo` adds a "Give to…"
 * menu of people. Says what happened, out loud too (aria-live), and clears the selection.
 */
export function BulkBar({ actions, giveTo }: { actions: BulkAction[]; giveTo?: { people: { id: string; firstName: string }[]; run: (ids: string[], personId: string) => Promise<BulkResult | { error: string }> } }) {
  const s = useSelection();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const reportMilestone = useReportMilestone();
  // A message shows until something new is ticked.
  const shown = message && (!s || s.selected.size === 0) ? message : null;
  if (!s?.active) return shown ? <p role="status" className="mt-3 text-sm font-bold text-foreground">{shown}</p> : null;
  const ids = [...s.selected];

  const go = (verb: string, run: () => Promise<BulkResult | { error: string }>) =>
    start(async () => {
      try {
        const r = await run();
        if ("error" in r) {
          setMessage(r.error);
          return;
        }
        if (r.milestone) reportMilestone(r.milestone);
        setMessage(bulkMessage(r, verb));
        s.setActive(false);
      } catch (err) {
        console.error("[bulk] failed", err);
        setMessage("Couldn't save that. Check your connection and try again.");
      }
    });

  return (
    // data-covers-bottom: the page keeps focused rows from hiding under it (globals.css).
    <div data-covers-bottom className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:border">
      <span className="mr-auto text-sm font-bold text-foreground" aria-live="polite">
        {ids.length === 0 ? "Tick the ones to change" : `${ids.length} selected`}
        {ids.length >= BULK_MAX && ` (${BULK_MAX} at most)`}
      </span>
      {actions.map((a) => (
        <button key={a.key} type="button" disabled={pending || ids.length === 0} onClick={() => go(a.verb, () => a.run(ids))} className={a === actions[0] ? btnPrimary : btn}>
          {a.label}
        </button>
      ))}
      {giveTo && giveTo.people.length > 0 && ids.length > 0 && !pending && (
        <MoreMenu label="Give the selected to" face={<span className="px-1 text-sm font-bold">Give to…</span>} triggerClassName={btn}>
          {giveTo.people.map((p) => (
            <button key={p.id} type="button" onClick={() => go("Gave", () => giveTo.run(ids, p.id))} className={menuItem}>
              {p.firstName}
            </button>
          ))}
        </MoreMenu>
      )}
      <button type="button" disabled={pending} onClick={() => s.setActive(false)} className={btn}>
        Cancel
      </button>
      {shown && (
        <p role="status" className="basis-full text-sm font-bold text-foreground">
          {shown}
        </p>
      )}
    </div>
  );
}
