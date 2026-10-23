"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_GROUPS, activeAppId } from "@/lib/apps";
import { useNav } from "./nav-context";

/** The nine-dot "all apps" button, Microsoft 365 style. Lives at the far left of the top bar. */
export function LauncherButton() {
  const { launcherOpen, setLauncherOpen } = useNav();
  return (
    <button
      type="button"
      aria-label="All apps"
      aria-expanded={launcherOpen}
      aria-controls={launcherOpen ? "app-launcher" : undefined}
      data-launcher-toggle
      onClick={() => setLauncherOpen(!launcherOpen)}
      // Fixed 5px tracks, centred: `grid-cols-3` alone stretched the columns to the button's
      // full width, so the outer dots sat on (and past) the round edge.
      className="grid size-10 shrink-0 grid-cols-[repeat(3,5px)] grid-rows-[repeat(3,5px)] place-content-center gap-[3px] rounded-xl bg-sun shadow-[inset_0_0_0_2px_var(--color-paper)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className="size-[5px] rounded-[1.5px] bg-ink" />
      ))}
    </button>
  );
}

export function AppLauncher() {
  const { launcherOpen } = useNav();
  // Mounted only while open, so search text and edit mode reset each time it opens.
  return launcherOpen ? <LauncherPanel /> : null;
}

function LauncherPanel() {
  const { apps, setLauncherOpen } = useNav();
  const current = activeAppId(usePathname());
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Escape, outside click and tabbing away close it. Focus starts in search on a laptop, but
  // on the panel itself on phones (focusing the input there pops the keyboard over the
  // sheet). On close, focus goes back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
    else panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLauncherOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (panelRef.current?.contains(target)) return;
      // The waffle/bottom-bar buttons toggle it themselves.
      if (target.closest?.("[data-launcher-toggle]")) return;
      setLauncherOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      const active = document.activeElement;
      if (opener?.isConnected && (!active || active === document.body || panel?.contains(active))) {
        opener.focus();
      }
    };
  }, [setLauncherOpen]);

  const q = query.trim().toLowerCase();
  const matches = apps.filter((a) => a.label.toLowerCase().includes(q));

  return (
    <div
      ref={panelRef}
      id="app-launcher"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onBlur={(e) => {
        const next = e.relatedTarget as Element | null;
        if (next && !e.currentTarget.contains(next) && !next.closest("[data-launcher-toggle]")) {
          setLauncherOpen(false);
        }
      }}
      className="fixed inset-x-2 top-16 z-40 outline-none max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl border-2 border-ink bg-card p-4 text-card-foreground shadow-[6px_6px_0_rgb(31_41_51/0.18)] max-md:bottom-[calc(var(--bottom-bar-h,0px)+0.5rem)] max-md:top-auto md:left-3 md:right-auto md:w-[30rem] dark:border-white/20"
    >
      <h2 id={titleId} className="sr-only">
        All apps
      </h2>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search apps…"
        aria-label="Search apps"
        className="w-full rounded-xl border-2 border-ink bg-background px-3 py-2 text-sm font-semibold outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:border-white/30"
      />

      {APP_GROUPS.map((group) => {
        const groupApps = matches.filter((a) => a.group === group.id);
        if (groupApps.length === 0) return null;
        return (
          <section key={group.id} className="mt-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{group.label}</h3>
            <ul className="mt-2 grid grid-cols-4 gap-2">
              {groupApps.map((app) => {
                const tile = (
                  <>
                    <span
                      className="grid size-12 place-items-center rounded-2xl border-2 border-ink text-2xl shadow-[2px_2px_0_rgb(31_41_51/0.13)]"
                      style={{ backgroundColor: app.tint }}
                      aria-hidden
                    >
                      {app.emoji}
                    </span>
                    <span className="text-xs font-extrabold">{app.label}</span>
                  </>
                );
                const cls = `relative grid w-full justify-items-center gap-1 rounded-2xl px-1 py-2 transition hover:bg-muted ${
                  app.id === current ? "bg-sun/30" : ""
                }`;
                return (
                  <li key={app.id}>
                    <Link
                      href={app.href}
                      onClick={() => setLauncherOpen(false)}
                      className={cls}
                      aria-current={app.id === current ? "page" : undefined}
                    >
                      {tile}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {matches.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No app called “{query}”.</p>}
    </div>
  );
}
