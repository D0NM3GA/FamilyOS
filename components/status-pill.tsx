"use client";

import { ChevronDown } from "lucide-react";
import { MoreMenu } from "@/components/more-menu";
import { menuItem } from "@/components/styles";
import type { PillLook, StatusOption, Tone } from "@/lib/work-items/types";

/**
 * Phase 59.1a: an item's status in the shared words (lib/work-items), and — when the viewer may
 * change it — a tap away from the next one. Each tone pairs a light and a `dark:` shade, all well
 * past 4.5:1 by Tailwind's values (red-800 on red-100 about 7:1); the browser test's `axe` pass over
 * /chores checks them in every look.
 */
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-foreground",
  soon: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  late: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  quiet: "bg-muted text-muted-foreground",
};

function Pill({ look, open }: { look: PillLook; open?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${TONE[look.tone]}`}>
      {look.label}
      {open && <ChevronDown size={12} aria-hidden />}
    </span>
  );
}

/**
 * `title` names the item for a screen reader ("Status of Spelling list: Due today"). With no
 * options it's just the label; with options the whole 44px box is the button.
 */
export function StatusPill<S extends string>({
  look,
  options,
  title,
  onPick,
  busy = false,
}: {
  look: PillLook;
  options?: StatusOption<S>[];
  title: string;
  onPick: (value: S) => void;
  /** Saving a pick: the pill stays a button (focus stays on it) but won't open. */
  busy?: boolean;
}) {
  if (!options || options.length === 0) return <Pill look={look} />;
  return (
    <MoreMenu
      label={`Status of ${title}: ${look.label}. Change it`}
      face={<Pill look={look} open />}
      triggerClassName="inline-flex min-h-11 shrink-0 items-center rounded-full px-1 sm:min-h-9 aria-disabled:opacity-60"
      busy={busy}
    >
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onPick(o.value)} className={menuItem}>
          {o.label}
        </button>
      ))}
    </MoreMenu>
  );
}
