"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarDays,
  CalendarSync,
  ChevronRight,
  Database,
  House,
  KeyRound,
  LayoutGrid,
  Lock,
  Megaphone,
  Palette,
  Search,
  ToggleRight,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { HubGroup, HubIcon, HubStatus, HubTile } from "@/lib/settings-hub";

const ICONS: Record<HubIcon, { Icon: LucideIcon; tint: string }> = {
  bell: { Icon: Bell, tint: "bg-sky-100 dark:bg-sky-500/15" },
  key: { Icon: KeyRound, tint: "bg-violet-100 dark:bg-violet-500/15" },
  lock: { Icon: Lock, tint: "bg-rose-100 dark:bg-rose-500/15" },
  calendar: { Icon: CalendarDays, tint: "bg-violet-100 dark:bg-violet-500/15" },
  house: { Icon: House, tint: "bg-amber-100 dark:bg-amber-500/15" },
  invite: { Icon: UserPlus, tint: "bg-lime-100 dark:bg-lime-500/15" },
  views: { Icon: LayoutGrid, tint: "bg-orange-100 dark:bg-orange-500/15" },
  palette: { Icon: Palette, tint: "bg-yellow-100 dark:bg-yellow-500/15" },
  apps: { Icon: ToggleRight, tint: "bg-slate-100 dark:bg-slate-500/15" },
  alerts: { Icon: Megaphone, tint: "bg-sky-100 dark:bg-sky-500/15" },
  outlook: { Icon: CalendarSync, tint: "bg-violet-100 dark:bg-violet-500/15" },
  data: { Icon: Database, tint: "bg-slate-100 dark:bg-slate-500/15" },
};

const TONE: Record<HubStatus["tone"], string> = {
  ok: "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-200",
  attention: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  neutral: "bg-muted text-muted-foreground",
};

const matches = (tile: HubTile, q: string) => `${tile.title} ${tile.description} ${tile.keywords}`.toLowerCase().includes(q);

/**
 * Phase 45.3: the Settings hub's groups of tiles, and the search box that narrows them as you
 * type. Each tile is a link with its status in words (tied to it for screen readers).
 */
export function SettingsHub({ groups }: { groups: HubGroup[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, tiles: q ? g.tiles.filter((t) => matches(t, q)) : g.tiles })).filter((g) => g.tiles.length);
  const count = shown.reduce((n, g) => n + g.tiles.length, 0);
  const searchId = useId();

  if (groups.length === 0) return null;
  return (
    <div className="space-y-7">
      <div role="search" className="max-w-md">
        <label htmlFor={searchId} className="sr-only">
          Search settings
        </label>
        <div className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-input bg-card px-3 focus-within:border-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search settings, like “PIN” or “colors”"
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p aria-live="polite" className="sr-only">
          {q ? `${count} ${count === 1 ? "setting" : "settings"} found` : ""}
        </p>
      </div>

      {shown.map((group) => (
        <section key={group.id} aria-labelledby={`hub-${group.id}`} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`hub-${group.id}`} className="font-heading text-2xl font-extrabold text-foreground">
              {group.title}
            </h2>
            <p className="text-sm text-muted-foreground">{group.scope}</p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3">
            {group.tiles.map((tile) => (
              <Tile key={tile.id} tile={tile} />
            ))}
          </ul>
        </section>
      ))}

      {q && count === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center">
          <p className="font-hand text-2xl text-brand-text">Nothing called &ldquo;{query.trim()}&rdquo; here.</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a word like &ldquo;PIN&rdquo;, &ldquo;invite&rdquo;, &ldquo;colors&rdquo; or &ldquo;backup&rdquo;.</p>
        </div>
      )}
    </div>
  );
}

function Tile({ tile }: { tile: HubTile }) {
  const { Icon, tint } = ICONS[tile.icon];
  const describedBy = `hub-tile-${tile.id}-about`;
  return (
    <li className={tile.preview ? "col-span-full" : undefined}>
      <Link
        href={tile.href}
        aria-describedby={describedBy}
        className="flex h-full flex-wrap items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 text-foreground transition hover:border-ring hover:bg-muted/40"
      >
        <span className="flex min-w-0 flex-[1_1_16rem] items-center gap-4">
          <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tint}`}>
            <Icon className="size-6" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-extrabold">{tile.title}</span>
            <span id={describedBy} className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">{tile.description}</span>
              {tile.status && <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[tile.status.tone]}`}>{tile.status.text}</span>}
            </span>
          </span>
        </span>
        {tile.preview && (
          <span aria-hidden="true" className="min-w-60 flex-[0_1_20rem] overflow-hidden rounded-xl border-2 border-border bg-muted">
            <span className="flex h-9 items-center bg-chrome px-3 font-heading text-lg font-extrabold text-white">
              {tile.preview.appName}
            </span>
            <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold">
              <span>Ivy: +5 {tile.preview.rewardMany}</span>
              {tile.preview.mascot && <span className="font-hand text-base font-normal text-brand-text">{tile.preview.mascot} says hi</span>}
            </span>
          </span>
        )}
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
