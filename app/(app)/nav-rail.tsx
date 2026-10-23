"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeAppId, BOTTOM_BAR_COUNT, railApps, type AppDef } from "@/lib/apps";
import { useNav } from "./nav-context";

// "Show more" remembers whether it was left open, per person, on this device. Same
// useSyncExternalStore pattern as components/theme-toggle.tsx, for the same reason: a
// localStorage value read during hydration would mismatch the server render.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
const moreKey = (personId: string) => `nav-more:${personId}`;
function readMore(personId: string) {
  try {
    return localStorage.getItem(moreKey(personId)) === "1";
  } catch {
    return false;
  }
}
function writeMore(personId: string, open: boolean) {
  try {
    localStorage.setItem(moreKey(personId), open ? "1" : "0");
  } catch {
    // Private mode / blocked storage: the toggle still works, it just won't be remembered.
  }
  for (const l of listeners) l();
}

function RailLink({ app, active }: { app: AppDef; active: boolean }) {
  return (
    <Link
      href={app.href}
      aria-current={active ? "page" : undefined}
      className={`flex w-20 flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-bold transition big:w-24 big:py-3 big:text-sm ${
        active ? "bg-sun text-ink" : "text-white/75 hover:bg-chrome-hover hover:text-white"
      }`}
    >
      <span className="text-xl leading-none big:text-3xl" aria-hidden>
        {app.emoji}
      </span>
      {app.label}
    </Link>
  );
}

/**
 * md+ only: the first apps in the fixed order, then "Show more" unfolding the rest in place
 * (Microsoft 365 admin center style). The rail scrolls on its own, never with the page, and
 * shows no scrollbar (no-scrollbar, app/globals.css): wheel, touch and keys still work.
 */
export function NavRail() {
  const { personId, apps } = useNav();
  const current = activeAppId(usePathname());
  const open = useSyncExternalStore(
    subscribe,
    () => readMore(personId),
    () => false,
  );
  const { first, more, folded } = railApps(apps, current, open);

  return (
    <nav
      aria-label="Apps"
      className="no-scrollbar hidden w-24 shrink-0 big:w-28 flex-col items-center gap-1 overflow-y-auto overscroll-contain bg-chrome py-3 md:flex [&>*]:shrink-0"
    >
      {first.map((app) => (
        <RailLink key={app.id} app={app} active={app.id === current} />
      ))}
      {folded && (
        <>
          <hr className="my-1 w-14 border-t-2 border-dashed border-white/25" />
          {more.map((app) => (
            <RailLink key={app.id} app={app} active={app.id === current} />
          ))}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => writeMore(personId, !open)}
            className="flex w-20 flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-extrabold text-sun transition hover:bg-chrome-hover"
          >
            <span className="text-base leading-none" aria-hidden>
              {open ? "▴" : "▾"}
            </span>
            {open ? "Show less" : "Show more"}
          </button>
        </>
      )}
    </nav>
  );
}

/** Below md the rail becomes a bottom bar: the first few apps plus "All apps". */
export function BottomBar() {
  const { apps, launcherOpen, setLauncherOpen } = useNav();
  const current = activeAppId(usePathname());

  return (
    <nav
      aria-label="Apps"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--bottom-bar-h)] items-stretch justify-around bg-chrome px-1 md:hidden"
    >
      {apps.slice(0, BOTTOM_BAR_COUNT).map((app) => {
        const active = app.id === current;
        return (
          <Link
            key={app.id}
            href={app.href}
            aria-current={active ? "page" : undefined}
            className={`my-1.5 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-bold big:text-sm ${
              active ? "bg-sun text-ink" : "text-white/80"
            }`}
          >
            <span className="text-xl leading-none big:text-2xl" aria-hidden>
              {app.emoji}
            </span>
            {app.label}
          </Link>
        );
      })}
      <button
        type="button"
        aria-label="All apps"
        aria-expanded={launcherOpen}
        aria-controls={launcherOpen ? "app-launcher" : undefined}
        data-launcher-toggle
        onClick={() => setLauncherOpen(!launcherOpen)}
        className="my-1.5 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-extrabold text-sun"
      >
        <span className="grid grid-cols-3 gap-[3px]" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} className="size-[5px] rounded-[1px] bg-sun" />
          ))}
        </span>
        All apps
      </button>
    </nav>
  );
}
