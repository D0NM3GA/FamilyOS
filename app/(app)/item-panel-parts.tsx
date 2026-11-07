"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { SelectBox, useSelection } from "@/components/selection";
import { iconBtn, chip } from "@/components/styles";
import type { WorkItem } from "@/lib/work-items/types";
import { setWorkItemStatus } from "./work-item-actions";
import { useReportMilestone } from "@/components/tasks/milestone-toast";

/**
 * Phase 59.4a: the side panel's frame (a bottom sheet on a phone, a right-hand panel on a computer,
 * like the look sheet), the pill that changes any item's status, the list view's one-line row, and
 * the Cards / List switch. The panel is a URL (?item=TYPE:id): back closes it, a link opens it.
 */
export function PanelShell({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [title]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu open in the panel closes first; the next Escape closes the panel.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(":popover-open")) router.replace(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, closeHref]);
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] space-y-4 overflow-y-auto rounded-t-3xl border-2 border-ink bg-card p-4 text-foreground shadow-2xl md:inset-x-auto md:top-16 md:right-0 md:bottom-0 md:max-h-none md:w-[26rem] md:rounded-none md:rounded-l-3xl dark:border-white/20"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 ref={heading} id={titleId} tabIndex={-1} className="font-heading text-xl font-extrabold outline-none">
          {title}
        </h2>
        <Link href={closeHref} replace scroll={false} aria-label="Close" className={iconBtn}>
          <X size={18} aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  );
}

/** Any item's pill, changing its status through the domain's own action (optimistic, put back on failure). */
export function ItemStatus<S extends string>({ item, refParam, locked = false }: { item: WorkItem<S>; refParam: string; locked?: boolean }) {
  const [status, setStatus] = useOptimistic(item.status);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const reportMilestone = useReportMilestone();
  const look = item.looks[status]!;
  const pick = (to: S) =>
    start(async () => {
      setFailed(false);
      setStatus(to);
      try {
        const r = await setWorkItemStatus(refParam, status, to);
        if (r && r.milestone) reportMilestone(r.milestone);
      } catch (err) {
        console.error("[item-status] failed", err);
        setFailed(true);
      }
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill look={look} options={pending || locked ? [] : item.options[status]} title={item.title} onPick={pick} />
      {failed && (
        <span role="alert" className="text-xs font-bold text-destructive">
          Couldn&apos;t save that. Refresh and try again.
        </span>
      )}
    </span>
  );
}

/** The list view's row: tick box (selecting), pill, title (opens the panel), who, when, extra. */
export function ItemListRow<S extends string>({
  item,
  refParam,
  href,
  who,
  when,
  extra,
  late,
  selectable = false,
}: {
  item: WorkItem<S>;
  refParam: string;
  href: string;
  who: string | null;
  when: string;
  extra?: string | null;
  late?: boolean;
  selectable?: boolean;
}) {
  // While selecting, the pill waits, like a card's own buttons.
  const selection = useSelection();
  const picking = selectable && Boolean(selection?.active);
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      {selectable && item.status === ("PENDING" as S) && <SelectBox id={item.id} label={item.title} />}
      <ItemStatus item={item} refParam={refParam} locked={picking} />
      <Link href={href} scroll={false} className="min-w-0 flex-1 basis-40 truncate text-sm font-bold text-foreground hover:underline">
        {item.title}
      </Link>
      <span className="text-xs text-muted-foreground">{who ?? "Anyone"}</span>
      <span className={`text-xs ${late ? "font-bold text-destructive" : "text-muted-foreground"}`}>{when}</span>
      {extra && <span className="text-xs text-muted-foreground">{extra}</span>}
    </li>
  );
}

// Cards or List, per person on this device: useSyncExternalStore like theme-toggle.tsx, so the server
// render (cards) and the first browser render agree, then the saved choice applies.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const viewKey = (personId: string, board: string) => `board-view:${board}:${personId}`;
function readView(personId: string, board: string): "cards" | "list" {
  try {
    return localStorage.getItem(viewKey(personId, board)) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}
function writeView(personId: string, board: string, v: "cards" | "list") {
  try {
    localStorage.setItem(viewKey(personId, board), v);
  } catch {
    // Blocked storage: the switch still works for this visit.
  }
  for (const l of listeners) l();
}

export function BoardView({ personId, board, cards, list }: { personId: string; board: string; cards: ReactNode; list: ReactNode }) {
  const view = useSyncExternalStore(subscribe, () => readView(personId, board), () => "cards" as const);
  return (
    <>
      <div className="mt-4 flex gap-2" role="group" aria-label="Show as">
        {(["cards", "list"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => writeView(personId, board, v)} className={chip}>
            {v === "cards" ? "Cards" : "List"}
          </button>
        ))}
      </div>
      {view === "list" ? list : cards}
    </>
  );
}

/** The panel's edit forms close it on save or Cancel, like a row's own edit closes itself. */
export function useClosePanel(closeHref: string) {
  const router = useRouter();
  return () => router.replace(closeHref, { scroll: false });
}
