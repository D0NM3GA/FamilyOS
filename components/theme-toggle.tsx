"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun, Monitor } from "lucide-react";

type Mode = "light" | "dark" | "system";

// Cycle order: whichever the OS is already doing (system) -> an explicit light pin -> an
// explicit dark pin -> back to system. Matches the common GitHub-style 3-state pattern
// rather than a plain on/off switch, so "follow the OS" stays reachable, not just an
// implicit default you lose once you've ever clicked the button.
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };
const THEME_COLOR_META_ID = "theme-color-override";

function resolveDark(mode: Mode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyMode(mode: Mode) {
  document.documentElement.classList.toggle("dark", resolveDark(mode));

  // app/layout.tsx's viewport renders two OS-media-queried theme-color tags.
  // Once the user pins an explicit mode, this single owned tag overrides both — browsers
  // pick the *first* matching meta[name=theme-color] in document order, so this must be
  // *prepended*, not appended, to actually win. Switching back to "system" removes it and
  // lets those two take over again, rather than fighting the server-rendered tags directly.
  const existing = document.getElementById(THEME_COLOR_META_ID);
  if (mode === "system") {
    existing?.remove();
    return;
  }
  // The top bar's own color (--chrome), now that the class above picked the theme: it's the
  // family's (Settings → Make it yours), same as app/layout.tsx's viewport.
  const color = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim() || (mode === "dark" ? "#0b1015" : "#1f2933");
  if (existing) {
    existing.setAttribute("content", color);
  } else {
    const meta = document.createElement("meta");
    meta.id = THEME_COLOR_META_ID;
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", color);
    document.head.prepend(meta);
  }
}

function readStoredMode(): Mode {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

// useSyncExternalStore, not useState+useEffect: this is exactly the case it exists for — a
// value that lives outside React (localStorage), is unknowable on the server, and must not
// cause a hydration mismatch. React renders getServerSnapshot() ("system") for the initial
// server AND client-hydration pass — genuinely identical output, no mismatch, no
// suppressHydrationWarning needed anywhere below — then synchronously re-renders with the
// real getSnapshot() value right after. A plain lazy useState initializer looks similar but
// isn't: it returns the real value *during* hydration itself, which is where the previous
// version of this file broke — either a live hydration-mismatch error (without
// suppressHydrationWarning) or, worse, React permanently keeping the wrong
// server-default DOM instead of the correct client value (with it, since
// suppressHydrationWarning means "the DOM wins", full stop).
//
// `notify()` covers this tab's own cycle() calls, which localStorage's own `storage` event
// deliberately never fires for (only *other* tabs get that event) — `storage` is still
// wired up too, so a theme change in one tab live-updates this toggle in every other open
// tab of the app.
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}
function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
function getServerSnapshot(): Mode {
  return "system";
}

/** Pins (or unpins) a mode: stored, every toggle told, and applied now. */
function setMode(next: Mode) {
  try {
    if (next === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", next);
  } catch {
    // Private browsing / storage blocked — theme still applies for this load (applyMode
    // below still runs), just won't persist across a reload or notify other tabs.
  }
  notify();
  applyMode(next);
}

/** Follows the OS live while in "system" (a DOM/meta mutation only, no setState). */
function useFollowSystem(mode: Mode) {
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);
}

/**
 * Light/dark/system toggle — a real top-bar control, not buried only in Settings (this
 * component is shared by both, see app/(app)/top-bar.tsx and app/(app)/settings/page.tsx).
 * The three icons are stacked and cross-faded/rotated rather than swapped outright, echoing
 * the idle/periscope crossfade already established by components/bunson.tsx.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, readStoredMode, getServerSnapshot);

  // Live-updates the actual dark/light class while in "system" mode and the OS preference
  // changes underneath.
  useFollowSystem(mode);

  function cycle() {
    setMode(NEXT[mode]);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[mode]} (click to change)`}
      aria-label={`Theme: ${LABEL[mode]}. Click to switch to ${LABEL[NEXT[mode]]}.`}
      className={`relative flex size-11 shrink-0 sm:size-8 items-center justify-center overflow-hidden rounded-md transition active:scale-90 ${className}`}
    >
      {(
        [
          [Sun, "light"],
          [Moon, "dark"],
          [Monitor, "system"],
        ] as const
      ).map(([Icon, iconMode]) => (
        <Icon
          key={iconMode}
          size={17}
          className={`absolute transition-all duration-300 ease-out ${
            mode === iconMode
              ? "rotate-0 scale-100 opacity-100"
              : "rotate-90 scale-50 opacity-0"
          }`}
        />
      ))}
    </button>
  );
}

/**
 * Phase 45.3: the same theme as three buttons side by side (Settings' own card), where the top
 * bar's ThemeToggle cycles. One store, so both always agree; it saves the moment it's tapped.
 */
export function ThemePicker() {
  const mode = useSyncExternalStore(subscribe, readStoredMode, getServerSnapshot);
  useFollowSystem(mode);
  return (
    <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
      {(
        [
          ["light", "Light", Sun],
          ["dark", "Dark", Moon],
          ["system", "Match device", Monitor],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-bold text-muted-foreground transition hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm sm:min-h-9"
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
