"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppName, Wordmark } from "@/components/family-look";
import { LauncherButton } from "./app-launcher";
import { ProfileMenu, type Prefs } from "./profile-menu";
import { Bell } from "./bell";

export function TopBar({
  personId,
  activeName,
  hasPhoto,
  color,
  prefs,
  unread,
}: {
  personId: string;
  activeName: string;
  hasPhoto: boolean;
  color: { bg: string; fg: string };
  prefs?: Prefs;
  /** Unread notification count; omitted hides the bell. */
  unread?: number;
}) {
  const appName = useAppName();
  return (
    <header className="flex h-16 items-center gap-3 bg-chrome px-3 text-white md:gap-4">
      <LauncherButton />
      {/* A family's own name can be long: it gives way (…) before the icons on a phone do. */}
      <span className="min-w-0 truncate py-1 font-heading text-xl font-extrabold leading-none sm:text-2xl" title={appName}>
        <Wordmark name={appName} accentClassName="text-sun" />
      </span>

      <form action="/search" method="get" className="relative hidden max-w-xl flex-1 sm:block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50"
        />
        <input
          type="search"
          name="q"
          placeholder="Find anything…"
          className="w-full rounded-xl bg-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder-white/50 outline-none focus:bg-white/15"
        />
      </form>

      {/* Gapless on a phone: four 44px thumb targets plus the logo only just fit 375px, and the
          icons' own padding already spaces them apart. */}
      <div className="ml-auto flex shrink-0 items-center sm:gap-3 md:gap-4">
        {/* The search box doesn't fit on a phone; the search page has its own. */}
        <Link
          href="/search"
          aria-label="Search"
          className="grid size-11 place-items-center rounded-md text-white/70 hover:bg-chrome-hover hover:text-white sm:hidden"
        >
          <Search size={18} />
        </Link>

        <ThemeToggle className="text-white/70 hover:bg-chrome-hover hover:text-white" />

        {unread !== undefined && <Bell unread={unread} />}

        <ProfileMenu personId={personId} activeName={activeName} hasPhoto={hasPhoto} color={color} prefs={prefs} />
      </div>
    </header>
  );
}
