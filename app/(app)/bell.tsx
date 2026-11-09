"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell as BellIcon } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { useHouseholdZone } from "@/components/household-zone";
import { getUnreadCount, openBell } from "./notification-actions";

type Item = { id: string; title: string; href: string; unread: boolean; createdAt: Date };

/**
 * Phase 20's bell (everyone's since Phase 23). The layout supplies the first count; after that it polls once
 * a minute and whenever the tab comes back into view, since a shared layout isn't
 * re-rendered on soft navigations and the other admin's actions never reach this tab.
 * Opening it loads the list and marks everything read.
 */
const POLL_MS = 60_000;

export function Bell({ unread: initialUnread }: { unread: number }) {
  const zone = useHouseholdZone();
  const [unread, setUnread] = useState(initialUnread);
  const [seenInitial, setSeenInitial] = useState(initialUnread);
  if (initialUnread !== seenInitial) {
    // A fresh layout render (navigation or revalidation) wins over the last poll.
    setSeenInitial(initialUnread);
    setUnread(initialUnread);
  }
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      getUnreadCount()
        .then(setUnread)
        .catch(() => {});
    };
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Phase 68c: the unread count on the installed app's icon, where the browser has it (desktop,
  // iOS home-screen apps; not Chrome on Android). Cleared at zero.
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge()).catch(() => {});
    // Signed out or switched away: the count isn't theirs to show any more.
    return () => void nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture, and marked handled: an item panel or look sheet underneath stays open (they skip a handled Escape).
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        // A disclosure, not a menu: aria-haspopup would promise arrow-key menu items it doesn't have.
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) return;
          // Last time's list would show old "unread" rows until the new one comes.
          setItems(null);
          setFailed(false);
          start(async () => {
            try {
              const r = await openBell();
              setItems(r.items);
              setUnread(r.unread);
            } catch (err) {
              console.error("[bell] loading notifications failed", err);
              setFailed(true);
            }
          });
        }}
        className="relative grid size-11 place-items-center rounded-md text-on-chrome/80 hover:bg-chrome-hover hover:text-on-chrome sm:size-9"
      >
        <BellIcon size={20} aria-hidden />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid sm:-right-0.5 sm:-top-0.5 min-w-5 place-items-center rounded-full border-2 border-chrome bg-tomato px-1 text-[11px] font-extrabold text-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="ui-card absolute right-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-xl border-2 border-ink bg-card p-2 text-sm text-foreground shadow-lg dark:border-white/20"
        >
          <p className="px-2 py-1 font-heading font-bold">Notifications</p>
          {failed ? (
            <p role="alert" className="px-2 py-3 text-sm text-destructive">Couldn&apos;t load these. Close and try again.</p>
          ) : pending || !items ? (
            <p className="px-2 py-3 text-muted-foreground">Loading…</p>
          ) : items && items.length > 0 ? (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-2 py-2 hover:bg-muted ${n.unread ? "font-bold" : ""}`}
                  >
                    {n.title}
                    <span className="block text-xs font-normal text-muted-foreground">{formatRelative(n.createdAt, zone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-muted-foreground">All quiet. Nothing new.</p>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="mt-1 flex min-h-11 items-center justify-center rounded-lg border-t border-border text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-9"
          >
            See all
          </Link>
        </div>
      )}
    </div>
  );
}
